import asyncio
import base64
import json
from datetime import datetime
import os
from loguru import logger

import websockets
from openai import AsyncOpenAI

from context import Context
from streaming_openai_util import stream_openai_request_and_accumulate_toolcalls
from audio_piping import VBcablePlayer

OPENAI_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
CARTESIA_WS_URL = "wss://api.cartesia.ai/tts/websocket"
CARTESIA_SAMPLE_RATE = 48000
CARTESIA_API_KEY = os.environ["CARTESIA_API_KEY"]


class Streaming:
    def __init__(
        self,
        context: Context,
        openai_client: AsyncOpenAI,
        silence_period_s: float = 5,
        thinking_period_s: float = 5,
    ):
        self.inflight_request_buffer = {}
        self.inflight_request_counter = 0
        self.cancelled_tool_calls = set()
        self.active_tool_call_tasks: list[asyncio.Task] = []
        self.model_consumer_generator = None
        self.audio_transcription_queue = asyncio.Queue()
        self.transcribed_text_queue = asyncio.Queue()
        self.tool_call_queue = asyncio.Queue()
        self.tts_text_queue = asyncio.Queue()
        self.openai_client = openai_client
        self.context = context
        self.silence_period_s = silence_period_s
        self.thinking_period_s = thinking_period_s
        self.last_text_received_timestamp = datetime.now()
        self.last_user_query_request_timestamp = datetime.now()
        self.last_background_request_timestamp = datetime.now()
        self.openai_realtime_transcription_ws_ctx_manager = websockets.connect(
            OPENAI_WS_URL,
            additional_headers={
                "Authorization": f"Bearer {openai_client.api_key}",
                "OpenAI-Beta": "realtime=v1",
            },
        )
        self.openai_realtime_transcription_ws = None
        self.pc_cable = VBcablePlayer(input_sample_rate=CARTESIA_SAMPLE_RATE)
        self.cartesia_ws = None

    async def run(self):
        self.openai_realtime_transcription_ws = (
            await self.openai_realtime_transcription_ws_ctx_manager.__aenter__()
        )
        # https://docs.cartesia.ai/2024-11-13/api-reference/tts/tts
        self.cartesia_ws = await websockets.connect(
            f"{CARTESIA_WS_URL}?api_key={CARTESIA_API_KEY}&cartesia_version=2024-11-13",
        )
        tasks = [
            asyncio.create_task(self.transcribe_loop()),
            asyncio.create_task(self.generate_response_tokens_loop()),
            asyncio.create_task(self.synthesize_speech_loop()),
            asyncio.create_task(self.playback_speech_loop()),
        ]
        await asyncio.gather(*tasks)

    async def close(self):
        await asyncio.gather(*self.active_tool_call_tasks)
        await self.openai_realtime_transcription_ws_ctx_manager.__aexit__(
            None, None, None
        )

    async def on_audio_packet_received(self, packet_data: bytes):
        # logger.debug("Received audio packet")
        assert self.openai_realtime_transcription_ws
        data = base64.b64encode(packet_data).decode("utf-8")
        await self.openai_realtime_transcription_ws.send(
            json.dumps({"type": "input_audio_buffer.append", "audio": data})
        )
        await self.openai_realtime_transcription_ws.send(
            json.dumps({"type": "input_audio_buffer.commit"})
        )

    async def on_transcribed_text_received(self, text: str):
        logger.debug("Received transcribed text: " + text)
        await self.transcribed_text_queue.put({"text": text})

    async def transcribe_loop(self):
        logger.info("Starting transcription loop")

        assert self.openai_realtime_transcription_ws

        await self.openai_realtime_transcription_ws.send(
            json.dumps(
                {
                    "type": "transcription_session.update",
                    "session": {
                        "input_audio_format": "pcm16",
                        "input_audio_transcription": {
                            "model": "gpt-4o-transcribe",
                            "prompt": "",
                            "language": "en",
                        },
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                        },
                        "input_audio_noise_reduction": {"type": "near_field"},
                        "include": [
                            # "item.input_audio_transcription.logprobs",
                        ],
                    },
                }
            )
        )

        while True:
            # TODO: Parse from the OpenAI response.
            # https://platform.openai.com/docs/guides/realtime-transcription#realtime-transcription-sessions
            result = await self.openai_realtime_transcription_ws.recv()

            logger.info("Received transcription result: " + repr(result))

            data = json.loads(result)
            if data["type"] == "conversation.item.input_audio_transcription.delta":
                await self.on_transcribed_text_received(data["delta"])

    async def handle_tool_call(self, tool_call: dict):
        # Handles the tool call.
        if tool_call["name"] == "recall":
            query = tool_call["arguments"]["query"]

            result = await self.context.recall(query)

        elif tool_call["name"] == "research":
            query = tool_call["arguments"]["query"]

    async def generate_response_tokens_loop(self):
        logger.info("Starting response generation loop")

        while True:
            try:
                # Dequeue all of the transcribed text and add it to the context.
                run_once = False
                while not run_once or not self.transcribed_text_queue.empty():
                    run_once = True
                    transcribed_text_chunk = await asyncio.wait_for(
                        self.transcribed_text_queue.get(), timeout=self.silence_period_s
                    )

                    self.context.add_text(
                        transcribed_text_chunk["text"],
                        role="user",
                        timestamp=datetime.now(),
                    )
                    self.last_text_received_timestamp = datetime.now()

                    logger.debug(
                        "Added text to context: " + repr(transcribed_text_chunk["text"])
                    )

                continue
            except asyncio.TimeoutError:
                # If there was a timeout, it means that the silence period has been reached,
                # and we are OK to send a request to OpenAI.
                logger.debug("Silence period reached.")
                pass

            # Don't make another request if we haven't received any new text since the previous request.
            no_new_text_received = (
                self.last_user_query_request_timestamp
                >= self.last_text_received_timestamp
            )
            background_request_period_passed = (
                datetime.now()
                - max(
                    self.last_user_query_request_timestamp,
                    self.last_background_request_timestamp,
                )
            ).total_seconds() < self.thinking_period_s

            if no_new_text_received and not background_request_period_passed:
                logger.debug("No new text received, skipping request.")
                continue

            # This is used for executing tool calls.
            event_loop = asyncio.get_event_loop()
            if background_request_period_passed and no_new_text_received:
                logger.info("Performing `background` request")

                # Do a "background" request.
                self.last_background_request_timestamp = datetime.now()
                async for delta in stream_openai_request_and_accumulate_toolcalls(
                    self.openai_client,
                    # TODO: Make a nicer prompt for handling 'background tasks'.
                    self.context.get_latest_finegrained_context()
                    + [
                        {
                            "role": "user",
                            "content": "Please now check if any of your background tasks could be applied here.",
                        }
                    ],
                    model="gpt-4o",
                ):
                    if delta["type"] == "tool_call":
                        logger.debug("Received toolcall delta: " + delta["text"])
                        # Add the 'tool call' to the list of running tasks.
                        self.context.add_tool_call_request(
                            delta["tool_call"]["function"]["name"],  # type: ignore
                            delta["tool_call"]["function"]["arguments"],  # type: ignore
                            delta["tool_call"]["id"],  # type: ignore
                            timestamp=datetime.now(),
                        )
                        task = event_loop.create_task(
                            self.handle_tool_call(delta["tool_call"])  # type: ignore
                        )
                        self.active_tool_call_tasks.append(task)
                    elif delta["type"] == "text":
                        logger.debug("Received text delta: " + delta["text"])
                        await self.tts_text_queue.put(delta["text"])
                        self.context.add_text(
                            delta["text"], "assistant", timestamp=datetime.now()
                        )

                    if not self.transcribed_text_queue.empty():
                        # Interrupt the response if new text was received.
                        logger.debug(
                            "Interrupting response due to new text in tts_text_queue."
                        )
                        break
            else:
                logger.info("Performing `user query` request")

                # Do a "user query" request (handling the new text as if it's a user query).
                self.last_user_query_request_timestamp = datetime.now()
                async for delta in stream_openai_request_and_accumulate_toolcalls(
                    self.openai_client,
                    self.context.get_latest_finegrained_context(),
                    model="gpt-4o",
                ):
                    if delta["type"] == "tool_call":
                        logger.debug("Received toolcall delta: " + delta["text"])
                        # Add the 'tool call' to the list of running tasks.
                        self.context.add_tool_call_request(
                            delta["tool_call"]["function"]["name"],  # type: ignore
                            delta["tool_call"]["function"]["arguments"],  # type: ignore
                            delta["tool_call"]["id"],  # type: ignore
                            timestamp=datetime.now(),
                        )
                        task = event_loop.create_task(
                            self.handle_tool_call(delta["tool_call"])  # type: ignore
                        )
                        self.active_tool_call_tasks.append(task)
                    elif delta["type"] == "text":
                        logger.debug("Received text delta: " + delta["text"])
                        self.context.add_text(
                            delta["text"], "assistant", timestamp=datetime.now()
                        )
                        await self.tts_text_queue.put(delta["text"])

                    if not self.transcribed_text_queue.empty():
                        # Interrupt the response if new text was received.
                        logger.debug(
                            "Interrupting response due to new text in tts_text_queue."
                        )
                        break

    async def synthesize_speech_loop(self):
        logger.info("Starting speech generation loop")

        has_sent_initial_sentence = False
        minimum_bootstrap_length = 6

        assert self.cartesia_ws is not None

        while True:
            if (
                not has_sent_initial_sentence
                and self.tts_text_queue.qsize() < minimum_bootstrap_length
                or self.tts_text_queue.empty()
            ):
                # Wait for a while to get some initial text.
                await asyncio.sleep(0.1)
                continue

            text = ""
            while not self.tts_text_queue.empty():
                text += await self.tts_text_queue.get()

            if text == "":
                continue

            logger.debug("Received text for TTS: " + repr(text))

            # Send the text to the Cartesia websocket.
            await self.cartesia_ws.send(
                json.dumps(
                    {
                        "model_id": "sonic-2",
                        "transcript": text,
                        "voice": {
                            "mode": "id",
                            "id": "a0e99841-438c-4a64-b679-ae501e7d6091",
                        },
                        "language": "en",
                        "context_id": "base-cartesia-context",
                        "output_format": {
                            "container": "raw",
                            "encoding": "pcm_s16le",
                            "sample_rate": 48000,
                        },
                        "add_timestamps": True,
                        "continue": True,
                    }
                )
            )

            has_sent_initial_sentence = True

    async def playback_speech_loop(self):
        logger.info("Starting playback loop")

        assert self.cartesia_ws is not None

        while True:
            data = json.loads(await self.cartesia_ws.recv())
            if data["type"] == "chunk":
                logger.debug("Received audio chunk")
                self.pc_cable.write(base64.b64decode(data["data"]))
            else:
                logger.info("Data: " + repr(data))


if __name__ == "__main__":
    pass
