import asyncio
import base64
import datetime
import json
import os
from io import BytesIO

import websockets
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


async def connect_to_openai():
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }

    async with websockets.connect(OPENAI_WS_URL, extra_headers=headers) as ws:
        print("Connected to OpenAI WebSocket.")

        try:
            while True:
                message = await ws.recv()  # Wait for messages from OpenAI
                data = json.loads(message)
                print("Received event:", json.dumps(data, indent=2))

        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection closed.")


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
        buffer = b""
        while True:
            buffer += await websocket.receive_bytes()
            if b"\n" in buffer:
                messages = buffer.split(b"\n")
                for message_string in messages:
                    try:
                        message = json.loads(message_string)

                        match message["type"]:
                            case "audio_packet":
                                await streaming.enqueue_audio_packet(message["data"])
                            case "image_packet":
                                image = base64_to_pil(message["data"])
                                if image is None:
                                    raise ValueError("Invalid image.")

                                context.add_image(image, datetime.datetime.now())
                            case _:
                                print("Wrong type")
                    except json.JSONDecodeError:
                        pass

    except WebSocketDisconnect:
        print("WebSocket disconnected")
        await streaming.join_remaining_tasks()
        streaming_task.cancel()
