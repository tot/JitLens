import asyncio
import wave
import websockets
from google import genai

client = genai.Client(api_key="GEMINI_API_KEY", http_options={'api_version': 'v1alpha'})
model = "gemini-2.0-flash-exp"

config = {"input_modalities": ["AUDIO"], "response_modalities": ["AUDIO"]}

async def handle_message(websocket, path):
    message = await websocket.recv()
    print(f"Received from JS: {message}")
    await websocket.send(f"Python processed: {message}")

async def main():
    async with client.aio.live.connect(model=model, config=config) as session:
        input_wf = wave.open("input_audio.wav", "wb")
        input_wf.setnchannels(1)
        input_wf.setsampwidth(2)
        input_wf.setframerate(24000)

        output_wf = wave.open("output_audio.wav", "wb")
        output_wf.setnchannels(1)
        output_wf.setsampwidth(2)
        output_wf.setframerate(24000)

        print("Listening for audio input...")
        async for response in session.receive():
            if response.data is not None:
                input_wf.writeframes(response.data)
                await session.send(input=response.data, end_of_turn=True)

                async for output_response in session.receive():
                    if output_response.data is not None:
                        output_wf.writeframes(output_response.data)

        input_wf.close()
        output_wf.close()
        print("Audio processing complete. Saved input as input_audio.wav and output as output_audio.wav")

        # Start WebSocket server after audio processing is complete
        start_server = websockets.serve(handle_message, "localhost", 8765)
        await start_server

if __name__ == "__main__":
    asyncio.run(main())
