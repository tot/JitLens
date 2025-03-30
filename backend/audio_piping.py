import numpy as np
import sounddevice as sd


class VBcablePlayer:
    def __init__(
        self,
        sample_rate=48000,
        blocksize=1024,
        latency="low",
        device_name="VB-Cable",
        channels=2,
    ):
        """
        Initialize the VBcablePlayer.

        :param sample_rate: The target sample rate (Hz).
        :param blocksize: Block size for streaming.
        :param latency: Desired latency setting (e.g., 'low', 'high', or a specific float in seconds).
        :param device_name: Name (or part of the name) of the target output device.
        :param channels: Number of channels (default is 2 for stereo).
        """
        self.sample_rate = sample_rate
        self.blocksize = blocksize
        self.latency = latency
        self.device_name = device_name
        self.channels = channels
        self.device_index = self._find_device()

    def _find_device(self):
        """
        Search for the specified output device and return its index.
        """
        devices = sd.query_devices()
        for idx, dev in enumerate(devices):
            if self.device_name in dev["name"]:
                print(f"Found {self.device_name} at index {idx}: {dev['name']}")
                return idx
        raise ValueError(
            f"{self.device_name} device not found. Please ensure it is installed and available."
        )

    def write(self, data):
        """
        Write audio data to the VB-Cable output device.

        :param data: Audio data in memory. It can be a NumPy array or bytes.
                     If provided as a NumPy array, it should have shape (n_samples,) for mono or (n_samples, channels) for multi-channel.
        """
        # Convert bytes data to NumPy array if necessary.
        if isinstance(data, bytes):
            data = np.frombuffer(data, dtype=np.int16)
        elif not isinstance(data, np.ndarray):
            raise ValueError("Data must be either a NumPy array or bytes.")

        # If data is mono but we need stereo, duplicate the channel.
        if data.ndim == 1 and self.channels == 2:
            data = np.column_stack((data, data))

        # Ensure the data is in 16-bit format.
        data = data.astype(np.int16)

        try:
            with sd.OutputStream(
                samplerate=self.sample_rate,
                device=self.device_index,
                channels=self.channels,
                dtype="int16",
                blocksize=self.blocksize,
                latency=self.latency,
            ) as stream:
                stream.write(data)
        except Exception as e:
            print("Error during playback:", e)
