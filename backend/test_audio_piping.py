import wave
from io import BytesIO

import numpy as np
import scipy.signal as sps
import sounddevice as sd
from audio_piping import AudioStreamer
from scipy.io import wavfile

print(sd.query_devices())

wave_read = wave.Wave_read("test_files/test_file.wav")
frames = wave_read.readframes(wave_read.getnframes())

# Convert frames to numpy.
frames = np.frombuffer(frames, dtype=np.int16)

new_rate = 48000
sample_rate = wave_read.getframerate()
# Read file
# sample_rate, clip = wavfile.read(BytesIO(file_name))

# Resample data
number_of_samples = round(len(frames) * float(new_rate) / sample_rate)
frames = sps.resample(frames, number_of_samples)[: sample_rate * 2]

# Convert to 2 channels.
if len(frames.shape) == 1:
    frames = np.stack((frames, frames), axis=1)

# Convert back to bytes.
# frames = frames.astype(np.int32).tobytes()
frames = frames.astype(np.int16).tobytes()

streamer = AudioStreamer(sample_rate=new_rate, channels=2)

print("Writing...")
streamer.write(frames)
print("Done")
