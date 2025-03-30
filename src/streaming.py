import asyncio
from datetime import datetime
import json

from openai import AsyncOpenAI

from context import Context


def _valid_json(text: str):
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        return False


async def _stream_openai_request_and_accumulate_toolcalls(
    openai_client: AsyncOpenAI, messages: list, model="gpt-4o"
):
    tool_calls = {}
    completed_tool_calls = set()
    async for chunk in await openai_client.chat.completions.create(
        model=model, messages=messages, stream=True
    ):
        delta = chunk.choices[0].delta

        if delta.tool_calls is not None:
            for tool_call in delta.tool_calls:
                if tool_call.index not in tool_calls:
                    tool_calls[tool_call.index] = {
                        "function": {"name": "", "arguments": ""}
                    }

                if tool_call.id is not None:
                    tool_calls[tool_call.index]["id"] = tool_call.id
                if tool_call.function is not None:
                    if tool_call.function.name is not None:
                        tool_calls[tool_call.index]["function"][
                            "name"
                        ] += tool_call.function.name
                    if tool_call.function.arguments is not None:
                        tool_calls[tool_call.index]["function"][
                            "arguments"
                        ] += tool_call.function.arguments

        # Check for completed tool calls.
        for tool_call in tool_calls.values():
            if (
                tool_call["id"] is not None
                and tool_call["function"]["name"] != ""
                and tool_call["function"]["arguments"] != ""
                and _valid_json(tool_call["function"]["arguments"])
                and tool_call["id"] not in completed_tool_calls
            ):
                completed_tool_calls.add(tool_call["id"])

                yield {"type": "tool_call", "tool_call": tool_call}

        # Check for content.
        if delta.content is not None:
            yield {"type": "text", "content": delta.content}


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
        self.model_consumer_generator = None
        self.audio_transcription_queue = asyncio.Queue()
        self.transcribed_text_queue = asyncio.Queue()
        self.tts_text_queue = asyncio.Queue()
        self.openai_client = openai_client
        self.context = context
        self.silence_period_s = silence_period_s
        self.thinking_period_s = thinking_period_s
        self.last_text_received_timestamp = datetime.now()
        self.last_user_query_request_timestamp = datetime.now()
        self.last_background_request_timestamp = datetime.now()

    async def enqueue_audio_packet(self, packet_data: bytes):
        await self.audio_transcription_queue.put(packet_data)

    async def process_audio_packets_loop(self):
        while not self.audio_transcription_queue.empty():
            packet = await self.audio_transcription_queue.get()

            # Send to OpenAI thing
            result = ...

            await self.transcribed_text_queue.put(result)

    async def generate_response_tokens_loop(self):
        while True:
            try:
                # Dequeue all of the transcribed text and add it to the context.
                while not self.transcribed_text_queue.empty():
                    transcribed_text_chunk = await asyncio.wait_for(
                        self.transcribed_text_queue.get(),
                        timeout=self.silence_period_s,
                    )
                    self.context.add_speech(transcribed_text_chunk, datetime.now())
                    self.last_text_received_timestamp = datetime.now()

                continue
            except asyncio.TimeoutError:
                # If there was a timeout, it means that the silence period has been reached,
                # and we are OK to send a request to OpenAI.
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
                continue

            if background_request_period_passed and no_new_text_received:
                # Do a "background" request.
                async for delta in _stream_openai_request_and_accumulate_toolcalls(
                    self.openai_client,
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
                        # Add the 'tool call' to the list of running tasks.
                        pass
                    elif delta["type"] == "text":
                        await self.tts_text_queue.put(delta["text"])
            else:
                async for delta in _stream_openai_request_and_accumulate_toolcalls(
                    self.openai_client,
                    self.context.get_latest_finegrained_context(),
                    model="gpt-4o",
                ):
                    if delta["type"] == "tool_call":
                        # Add the 'tool call' to the list of running tasks.
                        pass
                    elif delta["type"] == "text":
                        await self.tts_text_queue.put(delta["text"])

    async def generate_speech_loop(self):
        while not self.tts_text_queue.empty():
            text = await self.tts_text_queue.get()

            # Send to TTS thing (Cartesia or Eleven Labs)
            result = ...

            # send result to the speaker, so that it gets piped into the PC cable, and then it gets played
            # and the raybans will receive it
