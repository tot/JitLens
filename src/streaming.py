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
    aggregated_tool_calls: dict[int, dict] = {}
    completed_tool_calls = set()
    async for chunk in await openai_client.chat.completions.create(
        model=model, messages=messages, stream=True
    ):
        delta = chunk.choices[0].delta

        if delta.tool_calls is not None:
            for tool_call in delta.tool_calls:
                if tool_call.index not in aggregated_tool_calls:
                    aggregated_tool_calls[tool_call.index] = {
                        "function": {"name": "", "arguments": ""}
                    }

                if tool_call.id is not None:
                    aggregated_tool_calls[tool_call.index]["id"] = tool_call.id
                if tool_call.function is not None:
                    if tool_call.function.name is not None:
                        aggregated_tool_calls[tool_call.index]["function"][
                            "name"
                        ] += tool_call.function.name
                    if tool_call.function.arguments is not None:
                        aggregated_tool_calls[tool_call.index]["function"][
                            "arguments"
                        ] += tool_call.function.arguments

        # Check for completed tool calls.
        for aggregated_tool_call in aggregated_tool_calls.values():
            if (
                aggregated_tool_call["id"] is not None
                and aggregated_tool_call["function"]["name"] != ""
                and aggregated_tool_call["function"]["arguments"] != ""
                and _valid_json(aggregated_tool_call["function"]["arguments"])
                and aggregated_tool_call["id"] not in completed_tool_calls
            ):
                completed_tool_calls.add(aggregated_tool_call["id"])

                yield {"type": "tool_call", "tool_call": aggregated_tool_call}

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

    async def join_remaining_tasks(self):
        await asyncio.gather(*self.active_tool_call_tasks)

    async def enqueue_audio_packet(self, packet_data: bytes):
        await self.audio_transcription_queue.put(packet_data)

    async def process_audio_packets_loop(self):
        while True:
            packet = await self.audio_transcription_queue.get()

            # Send to OpenAI thing
            result = ...

            await self.transcribed_text_queue.put(result)

    async def handle_tool_call(self, tool_call: dict):
        # Handles the tool call.
        if tool_call["name"] == "recall":
            query = tool_call["arguments"]["query"]

            result = await self.context.recall(query)

        elif tool_call["name"] == "research":
            query = tool_call["arguments"]["query"]

    async def generate_response_tokens_loop(self):
        while True:
            try:
                # Dequeue all of the transcribed text and add it to the context.
                while not self.transcribed_text_queue.empty():
                    transcribed_text_chunk = await asyncio.wait_for(
                        self.transcribed_text_queue.get(),
                        timeout=self.silence_period_s,
                    )
                    self.context.add_text(
                        transcribed_text_chunk, role="user", timestamp=datetime.now()
                    )
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

            # This is used for executing tool calls.
            event_loop = asyncio.get_event_loop()
            if background_request_period_passed and no_new_text_received:
                # Do a "background" request.
                self.last_background_request_timestamp = datetime.now()
                async for delta in _stream_openai_request_and_accumulate_toolcalls(
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
                        await self.tts_text_queue.put(delta["text"])
                        self.context.add_text(
                            delta["text"], "assistant", timestamp=datetime.now()
                        )

                    if not self.tts_text_queue.empty():
                        # Interrupt the response if new text was received.
                        break
            else:
                # Do a "user query" request (handling the new text as if it's a user query).
                self.last_user_query_request_timestamp = datetime.now()
                async for delta in _stream_openai_request_and_accumulate_toolcalls(
                    self.openai_client,
                    self.context.get_latest_finegrained_context(),
                    model="gpt-4o",
                ):
                    if delta["type"] == "tool_call":
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
                        await self.tts_text_queue.put(delta["text"])

                    if not self.tts_text_queue.empty():
                        # Interrupt the response if new text was received.
                        break

    async def generate_speech_loop(self):
        while not self.tts_text_queue.empty():
            text = await self.tts_text_queue.get()

            # Send to TTS thing (Cartesia or Eleven Labs)
            result = ...

            # send result to the speaker, so that it gets piped into the PC cable, and then it gets played
            # and the raybans will receive it
