import asyncio
import wave

import dotenv
import openai

dotenv.load_dotenv()

from context import Context
from streaming import Streaming


async def main():
    openai_client = openai.AsyncOpenAI()

    context = Context("./context", openai_client)
    streaming = Streaming(context, openai_client)

    run_task = asyncio.create_task(streaming.run())

    wave_read = wave.Wave_read("test_files/test_file.wav")
    framerate = wave_read.getframerate()

    # print(framerate)
    # return

    await asyncio.sleep(1.0)

    await streaming.on_audio_packet_received(
        wave_read.readframes(wave_read.getnframes())
    )
    # chunk_size = framerate
    # for _ in range(0, wave_read.getnframes(), chunk_size):
    #     chunk = wave_read.readframes(chunk_size)
    #     if not chunk:
    #         break

    #     await streaming.on_audio_packet_received(chunk)
    #     await asyncio.sleep(1)

    await asyncio.gather(asyncio.sleep(15), run_task)


if __name__ == "__main__":
    asyncio.run(main())
    print("Done")
