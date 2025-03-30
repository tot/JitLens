import asyncio

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

    await asyncio.sleep(1.0)

    streaming.tts_text_queue.put_nowait("Hello!")
    streaming.tts_text_queue.put_nowait(" How")
    streaming.tts_text_queue.put_nowait(" are")
    streaming.tts_text_queue.put_nowait(" you")
    streaming.tts_text_queue.put_nowait(" doing")
    streaming.tts_text_queue.put_nowait(" today?")
    streaming.tts_text_queue.put_nowait(" I'm")
    streaming.tts_text_queue.put_nowait(" doing")
    streaming.tts_text_queue.put_nowait(" great.")

    await run_task


if __name__ == "__main__":
    asyncio.run(main())
    print("Done")
