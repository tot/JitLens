import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { spawn } from "bun";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

// Ensure temp directory exists
const TEMP_DIR = "./temp";
mkdir(TEMP_DIR).catch(() => {});

// Audio processing constants
const CHUNK_DURATION = 10000; // 10 seconds in milliseconds

// WAV file header structure
function createWavHeader(sampleRate: number, bitsPerSample: number, channels: number, dataLength: number) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');                     // ChunkID
    view.setUint32(4, 36 + dataLength, true);        // ChunkSize
    writeString(view, 8, 'WAVE');                     // Format

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');                    // Subchunk1ID
    view.setUint32(16, 16, true);                    // Subchunk1Size
    view.setUint16(20, 1, true);                     // AudioFormat (PCM)
    view.setUint16(22, channels, true);              // NumChannels
    view.setUint32(24, sampleRate, true);            // SampleRate
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true); // ByteRate
    view.setUint16(32, channels * (bitsPerSample / 8), true);             // BlockAlign
    view.setUint16(34, bitsPerSample, true);         // BitsPerSample

    // data sub-chunk
    writeString(view, 36, 'data');                    // Subchunk2ID
    view.setUint32(40, dataLength, true);            // Subchunk2Size

    return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

app.get("/", (c) => {
    return c.text("Hello Hono!");
});

app.get(
    '/ws',
    upgradeWebSocket((c) => {
        let wavConfig: { sampleRate: number; bitsPerSample: number; channels: number } | null = null;
        let audioChunks: ArrayBuffer[] = [];
        let chunkStartTime: number | null = null;
        let currentChunkNumber = 0;
        
        return {
            onOpen() {
                console.log("Connection opened on /ws");
            },
            async onMessage(event, ws) {
                if (typeof event.data === 'string') {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'wav_header') {
                            wavConfig = {
                                sampleRate: message.sampleRate,
                                bitsPerSample: message.bitsPerSample,
                                channels: message.channels
                            };
                            console.log('Received WAV configuration:', wavConfig);
                            ws.send(JSON.stringify({ type: 'wav_header_ack' }));
                        } else if (message.type === 'wav_chunk_info') {
                            if (!chunkStartTime || message.isFirstChunk) {
                                chunkStartTime = message.timestamp;
                                currentChunkNumber = 0;
                                console.log('Starting new audio segment at:', new Date(message.timestamp).toISOString());
                            }
                        }
                    } catch (error) {
                        console.error('Error parsing message:', error);
                        ws.send(JSON.stringify({ type: 'error', message: 'Failed to parse message' }));
                    }
                } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
                    try {
                        if (!wavConfig) {
                            throw new Error('WAV configuration not received');
                        }

                        // Convert Blob to ArrayBuffer if needed
                        const audioData = event.data instanceof Blob 
                            ? await event.data.arrayBuffer() 
                            : event.data;
                        
                        audioChunks.push(audioData);
                        currentChunkNumber++;

                        // Log progress every second (assuming 44.1kHz, 4096 buffer size)
                        if (currentChunkNumber % 10 === 0) {
                            console.log(`Received ${currentChunkNumber} chunks, total size: ${(audioChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0) / 1024).toFixed(2)}KB`);
                        }

                        // Check if we've accumulated 10 seconds of audio
                        if (chunkStartTime && (Date.now() - chunkStartTime) >= CHUNK_DURATION) {
                            // Calculate total data length
                            const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
                            
                            if (totalLength === 0) {
                                console.log('No audio data received in this chunk');
                                audioChunks = [];
                                chunkStartTime = Date.now();
                                return;
                            }

                            // Create WAV header
                            const header = createWavHeader(
                                wavConfig.sampleRate,
                                wavConfig.bitsPerSample,
                                wavConfig.channels,
                                totalLength
                            );

                            // Combine header and chunks
                            const finalBuffer = new Uint8Array(header.byteLength + totalLength);
                            finalBuffer.set(new Uint8Array(header), 0);
                            
                            let offset = header.byteLength;
                            for (const chunk of audioChunks) {
                                finalBuffer.set(new Uint8Array(chunk), offset);
                                offset += chunk.byteLength;
                            }

                            // Save the WAV file
                            const filename = join(TEMP_DIR, `audio_${new Date(chunkStartTime).toISOString().replace(/[:.]/g, '-')}.wav`);
                            await Bun.write(filename, finalBuffer);
                            console.log(`Saved 10-second audio file: ${filename} (${(finalBuffer.length / 1024).toFixed(2)}KB)`);

                            // Reset for next chunk
                            audioChunks = [];
                            chunkStartTime = Date.now();
                            currentChunkNumber = 0;
                            ws.send(JSON.stringify({ 
                                type: 'chunk_saved',
                                filename: filename
                            }));
                        }
                    } catch (error) {
                        console.error('Error processing audio chunk:', error);
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: error instanceof Error ? error.message : 'Unknown error processing audio chunk'
                        }));
                    }
                } else {
                    // Handle text messages (like screenshots)
                    try {
                        const message = JSON.parse(event.data.toString());
                        if (message.type === 'screenshot') {
                            console.log("Received screenshot data");
                            const base64Data = message.data.replace(/^data:image\/\w+;base64,/, '');
                            const imageBuffer = Buffer.from(base64Data, 'base64');
                            
                            const filename = `screenshot_${Date.now()}.png`;
                            await Bun.write(filename, imageBuffer);
                            console.log(`Screenshot saved as ${filename}`);
                            ws.send("Screenshot saved successfully");
                        }
                    } catch (error) {
                        console.error('Error parsing message:', error);
                        ws.send('Error processing message');
                    }
                }
            },
            onClose: () => {
                console.log("Connection closed");
                // Clean up any remaining audio processing
                audioChunks = [];
                wavConfig = null;
                chunkStartTime = null;
                currentChunkNumber = 0;
            },
        }
    })
);

export default {
    fetch: app.fetch,
    websocket,
};
