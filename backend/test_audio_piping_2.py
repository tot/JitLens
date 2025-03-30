import wave
import numpy as np
import scipy.signal as sps
import sounddevice as sd

# Search for the VB-Cable device.
devices = sd.query_devices()
vb_cable_index = None
for idx, dev in enumerate(devices):
    if "VB-Cable" in dev["name"]:
        vb_cable_index = idx
        break

if vb_cable_index is None:
    raise ValueError(
        "VB-Cable device not found. Please ensure VB-Cable is installed and available."
    )

print("Using device:", devices[vb_cable_index]["name"])

# Open the WAV file.
with wave.open("test_files/test_file.wav", "rb") as wf:
    original_rate = wf.getframerate()
    n_frames = wf.getnframes()
    audio_bytes = wf.readframes(n_frames)

# Convert the byte data to a numpy array.
audio_data = np.frombuffer(audio_bytes, dtype=np.int16)

# Define the target sample rate.
new_rate = 48000

# Resample if the original rate differs from the new_rate.
if original_rate != new_rate:
    num_samples = round(len(audio_data) * new_rate / original_rate)
    audio_data = sps.resample(audio_data, num_samples)
    # Ensure the data remains in 16-bit range.
    audio_data = np.clip(audio_data, -32768, 32767).astype(np.int16)

# Convert to stereo if the audio is mono.
if audio_data.ndim == 1:
    audio_data = np.column_stack((audio_data, audio_data))

# Option 1: Play using sd.play (simple method)
# sd.play(audio_data, samplerate=new_rate, device=vb_cable_index)
# sd.wait()

# Option 2: Use an OutputStream for more control over buffering/latency.
# Adjust the blocksize and latency if needed.
try:
    with sd.OutputStream(
        samplerate=new_rate,
        device=vb_cable_index,
        channels=2,
        dtype="int16",
        blocksize=1024,  # You can try different block sizes (e.g., 512, 1024, 2048)
        latency="low",  # Alternatively, experiment with 'high' or a specific float value (in seconds)
    ) as stream:
        stream.write(audio_data)
except Exception as e:
    print("Error during playback:", e)
