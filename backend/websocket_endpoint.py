import asyncio
import base64
import datetime
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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global ctx_counter
    log_dir = f"./context_{ctx_counter}/"
    ctx_counter += 1
    context = Context(log_dir, openai_client)

    streaming = Streaming(context, openai_client)
    await websocket.accept()
    streaming_task = asyncio.create_task(streaming.run())
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
