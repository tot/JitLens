import asyncio
import base64
import datetime
import os
import time
from io import BytesIO

from dotenv import load_dotenv

load_dotenv()
from context import Context
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from loguru import logger
from openai import AsyncOpenAI
from PIL import Image
from streaming import Streaming

app = FastAPI()

openai_client = AsyncOpenAI()
ctx_counter = 0

while os.path.exists(f"./context_{ctx_counter}"):
    ctx_counter += 1

THINKING_PERIOD_S = 5
SILENCE_PERIOD_S = 1

# context = None
# streaming = None


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global ctx_counter  # , context, streaming
    log_dir = f"./context_{ctx_counter}/"
    ctx_counter += 1
    # if context is None:
    context = Context(log_dir, openai_client)
    indexing_task = asyncio.create_task(context._index_images())
    # if streaming is None:
    streaming = Streaming(
        context,
        openai_client,
        silence_period_s=SILENCE_PERIOD_S,
        thinking_period_s=THINKING_PERIOD_S,
    )
    streaming_task = asyncio.create_task(streaming.run())

    await websocket.accept()
    await asyncio.sleep(1.0)
    t0 = time.time()
    try:
        while True:
            message = await websocket.receive_json()
            match message["type"]:
                case "audio_packet":
                    # logger.debug("Received audio packet")
                    frames = base64.b64decode(message["data"])
                    await streaming.on_audio_packet_received(
                        frames, message["sound_level"]
                    )
                case "image_packet":
                    logger.debug("Received image packet")
                    image_data = base64.b64decode(message["data"])
                    image = Image.open(BytesIO(image_data))

                    context.add_image(image, datetime.datetime.now())
                case _:
                    print("Wrong type")
    except WebSocketDisconnect:
        print("WebSocket disconnected")
        await streaming.close()
        streaming_task.cancel()
