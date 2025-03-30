import asyncio
import base64
import datetime
import os
from io import BytesIO
import time
import wave

from dotenv import load_dotenv

load_dotenv()
from context import Context
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from loguru import logger
from openai import AsyncOpenAI
from PIL import Image
from streaming import Streaming

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


def base64_to_pil(base64_string):
    try:
        image_data = base64.b64decode(base64_string)
        image = Image.open(BytesIO(image_data))
        return image
    except Exception as e:
        print(f"Error converting base64 to PIL: {e}")
        return None


OPENAI_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription"


app = FastAPI()

openai_client = AsyncOpenAI()
ctx_counter = 0


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global ctx_counter
    buf = b""
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
                    image = base64_to_pil(message["data"])
                    if image is None:
                        raise ValueError("Invalid image.")

                    context.add_image(image, datetime.datetime.now())
                case _:
                    print("Wrong type")
    except WebSocketDisconnect:
        print("WebSocket disconnected")
        await streaming.close()
        streaming_task.cancel()
