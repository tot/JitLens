import asyncio
import base64
import datetime
import json
import os
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, websockets
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


curr_stream = Streaming()

app = FastAPI()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, context: Context):
    await websocket.accept()
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
                                curr_stream.enqueue_audio_packet(message["data"])
                            case "image_packet":
                                conv_image=base64_to_pil(
                                        message["data"], datetime.datetime.now()
                                    )
                                if conv_image:
                                    context.add_image(
                                        conv_image
                                    )
                                else:
                                    print("Failed image conversion")
                            case _:
                                print("Wrong type")
                    except json.JSONDecodeError:
                        pass

    except WebSocketDisconnect:
        print("WebSocket disconnected")


@app.on_event("startup")
async def startup_event():
    asyncio.create_task()
    asyncio.create_task(connect_to_openai())
