import asyncio
import websockets
import wave

async def send_audio(websocket, path):
    """Send mock audio data over the WebSocket connection."""
    with wave.open("./../../data/test_audio.wav", "rb") as wf:
        chunk_size = 1024  # Send data in chunks
        while chunk := wf.readframes(chunk_size):
            await websocket.send(chunk)
            await asyncio.sleep(0.1)  # Simulate real-time streaming

async def main():
    server = await websockets.serve(send_audio, "localhost", 8765)
    print("Mock WebSocket server started on ws://localhost:8765")
    await server.wait_closed()

asyncio.run(main())

