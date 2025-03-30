import asyncio
import wave
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
import httpx
import tempfile

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


app = FastAPI()

# Dictionary to store active WebSocket connections
active_connections = {}

# WebSocket endpoint to handle connections
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(client_id: int, websocket: WebSocket):
    await websocket.accept()
    active_connections[client_id] = websocket

    try:
        while True:
            data = await websocket.receive_bytes()

            if data.startswith("transcription_request"):
                await handle_transcription(client_id)

    except WebSocketDisconnect:
        del active_connections[client_id]

async def handle_transcription(client_id: int):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"client_id": client_id, "action": "start_transcription"}
        )

        if response.status_code == 200:
            pass
        else:
            pass
