import base64

from fastapi import FastAPI, WebSocket
import wave

app = FastAPI()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    data = b""
    while True:
        message = await websocket.receive_json()
        match message["type"]:
            case "audio_packet":
                # logger.debug("Received audio packet")
                data += base64.b64decode(message["data"].encode("utf-8"))

                with wave.open("recording.wav", "wb") as writer:
                    writer.setframerate(48000)
                    writer.setnchannels(1)
                    writer.setsampwidth(2)
                    writer.setnframes(len(data) // 2)
                    writer.writeframes(data)
                    print("Writing data:", len(data) // 2, "frames")

            case "image_packet":
                pass
            case _:
                print("Wrong type")


# with wave.open("recording.wav", "rb") as reader:
#     params = reader.getparams()
#     print(params)
#     data = reader.readframes(params.nframes)
#     data = np.frombuffer(data, dtype=np.int16)
#     print(data)
#     print(data.shape)
#     print(data[0:10])
