import asyncio
import sys
import wave

import openai
import dotenv

from context import Context
from streaming import Streaming
import loguru

dotenv.load_dotenv()


async def main():
    openai_client = openai.AsyncOpenAI()

    context = Context("./context", openai_client)
    streaming = Streaming(context, openai_client)

    run_task = asyncio.create_task(streaming.run())

    wave_read = wave.Wave_read("test_files/test_file.wav")
    framerate = wave_read.getframerate()

    streaming.transcribed_text_queue.put_nowait(
        {
            "text": "Hello!",
        }
    )

    # for _ in range(0, wave_read.getnframes(), chunk_size):
    #     chunk = wave_read.readframes(chunk_size)
    #     if not chunk:
    #         break

    #     await streaming.transcribed_text_queue(chunk)

    await asyncio.gather(asyncio.sleep(15), run_task)


if __name__ == "__main__":
    asyncio.run(main())
    print("Done")
