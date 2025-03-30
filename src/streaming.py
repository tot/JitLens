import asyncio
from datetime import datetime

from openai import AsyncOpenAI

from context import Context


class Streaming:
    def __init__(
        self, context: Context, openai_client: AsyncOpenAI, silence_period_s: int = 5
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
        self.last_text_received_timestamp = datetime.now()
        self.last_request_timestamp = datetime.now()

    def consume_model_tokens(self):
        pass

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
            if self.last_request_timestamp >= self.last_text_received_timestamp:
                continue

            tool_calls = {}

            async for chunk in await self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=self.context.get_latest_context(),
                stream=True,
            ):
                delta = chunk.choices[0].delta

                if not self.transcribed_text_queue.empty():
                    pass

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

                content = delta.content
                if content is not None:
                    await self.tts_text_queue.put(delta.content)

    async def generate_speech_loop(self):
        while not self.tts_text_queue.empty():
            text = await self.tts_text_queue.get()

            # Send to TTS thing (Cartesia or Eleven Labs)
            result = ...

            # send result to the speaker, so that it gets piped into the PC cable, and then it gets played
            # and the raybans will receive it
