from typing import Generator
import asyncio


class Streaming:
    def __init__(self):
        self.inflight_request_buffer = {}
        self.inflight_request_counter = 0
        self.model_consumer_generator = None
        self.audio_transcription_queue = asyncio.Queue()
        self.transcribed_text_queue = asyncio.Queue()
        self.tts_text_queue = asyncio.Queue()

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
        # start the chatcompletion

        # wait for streaming results from the chatcompletion (we'll receive deltas for this)

        # "Hello, how are you doing today?"

        # "Hello"
        # ","
        # " how"
        # " are"

        stream = []
        for delta in stream:
            await self.tts_text_queue.put(delta)

    async def generate_speech_loop(self):
        while not self.tts_text_queue.empty():
            text = await self.tts_text_queue.get()

            # Send to TTS thing (Cartesia or Eleven Labs)
            result = ...

            # send result to the speaker, so that it gets piped into the PC cable, and then it gets played
            # and the raybans will receive it
