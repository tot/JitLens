import asyncio
import wave
import websockets
from google.generativeai import genai

client = genai.Client(api_key="GEMINI_API_KEY", http_options={'api_version': 'v1alpha'})
model = "gemini-2.0-flash-exp"

# async def handle_message(websocket, path):
#     message = await websocket.recv()
#     print(f"Received from JS: {message}")
#     await websocket.send(f"Python processed: {message}")

config = {"response_modalities": ["AUDIO"]}

async def receive_audio_from_ws():
    async with websockets.connect("ws://localhost:8765") as websocket:
        input_wf = wave.open("input_audio.wav", "wb")
        input_wf.setnchannels(1)
        input_wf.setsampwidth(2)
        input_wf.setframerate(24000)

        print("Receiving audio from WebSocket server...")

        while True:
            try:
                data = await websocket.recv() 
                if isinstance(data, bytes):
                    input_wf.writeframes(data)
                else:
                    print(f"Unexpected data type received: {type(data)}")

            except websockets.exceptions.ConnectionClosed:
                print("WebSocket connection closed.")
                break

        input_wf.close()
        print("Saved input audio as input_audio.wav")

async def process_audio_with_gemini():
    async with client.aio.live.connect(model=model, config=config) as session:
        with open("input_audio.wav", "rb") as f:
            audio_data = f.read()

        await session.send(input=audio_data, end_of_turn=True)

        output_wf = wave.open("output_audio.wav", "wb")
        output_wf.setnchannels(1)
        output_wf.setsampwidth(2)
        output_wf.setframerate(24000)

        async for output_response in session.receive():
            if output_response.data is not None:
                output_wf.writeframes(output_response.data)

        output_wf.close()
        print("Audio processing complete. Saved output as output_audio.wav")

async def main():
    await receive_audio_from_ws()
    await process_audio_with_gemini()

if __name__ == "__main__":
    asyncio.run(main())
