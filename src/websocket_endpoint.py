import asyncio
import base64
import datetime
import os
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from openai import AsyncOpenAI
from PIL import Image

from context import Context
from streaming import Streaming

load_dotenv()

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
    log_dir = f"./context_{ctx_counter}/"
    ctx_counter += 1
    context = Context(log_dir, openai_client)

    streaming = Streaming(context, openai_client)
    await websocket.accept()
    streaming_task = asyncio.create_task(streaming.run())
    try:
        while True:
            message = await websocket.receive_json()
            match message["type"]:
                case "audio_packet":
                    await streaming.on_audio_packet_received(message["data"])
                case "image_packet":
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
