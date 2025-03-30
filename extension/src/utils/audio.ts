// Create WAV header
export const createWavHeader = (
    dataLength: number,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
) => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    view.setUint8(0, "R".charCodeAt(0));
    view.setUint8(1, "I".charCodeAt(0));
    view.setUint8(2, "F".charCodeAt(0));
    view.setUint8(3, "F".charCodeAt(0));
    view.setUint32(4, 36 + dataLength, true);
    view.setUint8(8, "W".charCodeAt(0));
    view.setUint8(9, "A".charCodeAt(0));
    view.setUint8(10, "V".charCodeAt(0));
    view.setUint8(11, "E".charCodeAt(0));

    // fmt sub-chunk
    view.setUint8(12, "f".charCodeAt(0));
    view.setUint8(13, "m".charCodeAt(0));
    view.setUint8(14, "t".charCodeAt(0));
    view.setUint8(15, " ".charCodeAt(0));
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
    view.setUint16(32, channels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    view.setUint8(36, "d".charCodeAt(0));
    view.setUint8(37, "a".charCodeAt(0));
    view.setUint8(38, "t".charCodeAt(0));
    view.setUint8(39, "a".charCodeAt(0));
    view.setUint32(40, dataLength, true);

    return buffer;
};

// Convert to 16-bit PCM with dithering
export const convertTo16BitPCM = (
    pcm16Data: Int16Array<ArrayBuffer>,
    inputData: Float32Array<ArrayBufferLike>
) => {
    for (let i = 0; i < inputData.length; i++) {
        const dither = (Math.random() * 2 - 1) * 0.0001;
        const sample = Math.max(-1, Math.min(1, inputData[i] + dither));
        pcm16Data[i] = Math.round(sample * 32767);
    }
};

// Create WAV data
export const createWavData = (
    audioContext: AudioContext,
    pcm16Data: Int16Array<ArrayBuffer>,
    inputData: Float32Array<ArrayBufferLike>
) => {
    // Convert to 16-bit PCM with dithering
    convertTo16BitPCM(pcm16Data, inputData);

    // Create WAV header
    const wavHeader = createWavHeader(pcm16Data.byteLength, audioContext.sampleRate, 1, 16);

    // Combine header and audio data
    const fullWavData = new Uint8Array(wavHeader.byteLength + pcm16Data.byteLength);
    fullWavData.set(new Uint8Array(wavHeader), 0);
    fullWavData.set(new Uint8Array(pcm16Data.buffer), wavHeader.byteLength);

    return fullWavData;
};

// Encode WAV data in base64
export const encodeWavToBase64 = (wavData: Uint8Array<ArrayBuffer>) => {
    return btoa(String.fromCharCode.apply(null, Array.from(wavData)));
};
