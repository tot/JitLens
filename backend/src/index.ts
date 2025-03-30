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

// Audio validation constants
const EXPECTED_CHUNK_SIZE = 2048; // Number of samples per chunk
const MAX_ABSOLUTE_VALUE = 32767; // Max value for 16-bit audio
const MIN_ACCEPTABLE_RMS = 100; // Minimum RMS value for valid audio
const MAX_ACCEPTABLE_RMS = 20000; // Maximum RMS value before likely clipping

// Function to validate PCM16 chunk
function validatePcm16Chunk(chunk: Buffer, expectedSize: number): { isValid: boolean; reason?: string } {
    // Check if chunk size is correct (2 bytes per sample)
    if (chunk.length !== expectedSize * 2) {
        return { 
            isValid: false, 
            reason: `Invalid chunk size: ${chunk.length} bytes (expected ${expectedSize * 2})` 
        };
    }

    // Check if data is actually 16-bit
    const int16Array = new Int16Array(chunk.buffer);
    let zeroCount = 0;
    
    for (let i = 0; i < int16Array.length; i++) {
        if (Math.abs(int16Array[i]) > MAX_ABSOLUTE_VALUE) {
            return { 
                isValid: false, 
                reason: `Sample value out of range: ${int16Array[i]} at position ${i}` 
            };
        }
        if (int16Array[i] === 0) {
            zeroCount++;
        }
    }

    // Check if there are too many zero samples (might indicate silent audio)
    if (zeroCount > int16Array.length * 0.9) {
        return {
            isValid: false,
            reason: 'Audio appears to be silent (too many zero samples)'
        };
    }

    return { isValid: true };
}

// Function to create WAV header
function createWavHeader(dataLength: number, sampleRate: number): Buffer {
    const buffer = Buffer.alloc(44);
    
    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(dataLength + 36, 4);
    buffer.write('WAVE', 8);
    
    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(1, 22); // num channels
    buffer.writeUInt32LE(sampleRate, 24); // sample rate
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    
    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    
    return buffer;
}

// Function to calculate audio statistics with quality indicators
function calculateAudioStats(chunk: Buffer): { 
    rms: number;
    peakLevel: number;
    avgLevel: number;
    quality: 'good' | 'warning' | 'poor';
    qualityReason?: string;
} {
    const int16Array = new Int16Array(chunk.buffer);
    let sum = 0;
    let sumSquares = 0;
    let peak = 0;
    let consecutiveZeros = 0;
    let maxConsecutiveZeros = 0;
    
    for (let i = 0; i < int16Array.length; i++) {
        const sample = int16Array[i];
        const abs = Math.abs(sample);
        
        // Track consecutive zeros
        if (sample === 0) {
            consecutiveZeros++;
            maxConsecutiveZeros = Math.max(maxConsecutiveZeros, consecutiveZeros);
        } else {
            consecutiveZeros = 0;
        }
        
        sum += abs;
        sumSquares += sample * sample;
        peak = Math.max(peak, abs);
    }
    
    const avg = sum / int16Array.length;
    const rms = Math.sqrt(sumSquares / int16Array.length);
    
    // Determine audio quality
    let quality: 'good' | 'warning' | 'poor' = 'good';
    let qualityReason = '';
    
    if (rms < MIN_ACCEPTABLE_RMS) {
        quality = 'poor';
        qualityReason = 'Audio level too low';
    } else if (rms > MAX_ACCEPTABLE_RMS) {
        quality = 'warning';
        qualityReason = 'Possible audio clipping';
    } else if (maxConsecutiveZeros > int16Array.length * 0.1) {
        quality = 'warning';
        qualityReason = 'Detected silence gaps';
    }
    
    return {
        rms,
        peakLevel: peak,
        avgLevel: avg,
        quality,
        qualityReason
    };
}

app.get("/", (c) => {
    return c.text("Hello Hono!");
});

app.get(
    '/ws',
    upgradeWebSocket((c) => {
        let audioChunks: Buffer[] = [];
        let sampleCount = 0;
        let lastSaveTime = Date.now();
        let currentSampleRate = 48000; // Default sample rate
        let chunkCounter = 0; // Add counter for debugging
        
        return {
            onOpen() {
                console.log("Connection opened on /ws");
                audioChunks = [];
                sampleCount = 0;
                chunkCounter = 0;
                lastSaveTime = Date.now();
            },
            async onMessage(event, ws) {
                if (typeof event.data === 'string') {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'audio_info') {
                            currentSampleRate = message.sampleRate;
                            console.log(`Received sample rate: ${currentSampleRate}Hz`);
                        }
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
                    try {
                        const pcmChunk = Buffer.from(
                            event.data instanceof Blob ? 
                            await event.data.arrayBuffer() : 
                            event.data
                        );
                        
                        // Validate the PCM chunk
                        const validation = validatePcm16Chunk(pcmChunk, EXPECTED_CHUNK_SIZE);
                        if (!validation.isValid) {
                            console.error(`Invalid PCM data: ${validation.reason}`);
                            ws.send(`Error: Invalid PCM data - ${validation.reason}`);
                            return;
                        }

                        // Calculate audio statistics
                        const stats = calculateAudioStats(pcmChunk);
                        chunkCounter++;
                        console.log(`Chunk #${chunkCounter} - Audio stats - RMS: ${stats.rms.toFixed(2)}, Peak: ${stats.peakLevel}, Quality: ${stats.quality}${stats.qualityReason ? ` (${stats.qualityReason})` : ''}`);

                        // Save each chunk as a WAV file
                        const wavHeader = createWavHeader(pcmChunk.length, currentSampleRate);
                        const wavFile = Buffer.concat([wavHeader, pcmChunk]);
                        const chunkFilename = join(TEMP_DIR, `chunk_${chunkCounter}_${Date.now()}_${stats.rms.toFixed(0)}_rms.wav`);
                        await Bun.write(chunkFilename, wavFile);
                        console.log(`Saved chunk WAV file: ${chunkFilename}`);

                        // Store the PCM chunk for the 10-second compilation
                        audioChunks.push(pcmChunk);
                        sampleCount += pcmChunk.length / 2;

                        // Calculate elapsed time and expected samples
                        const now = Date.now();
                        const elapsedMs = now - lastSaveTime;
                        const expectedSamples = (currentSampleRate * elapsedMs) / 1000;
                        
                        console.log(`Time since last save: ${elapsedMs}ms, Samples collected: ${sampleCount}, Expected samples: ${expectedSamples.toFixed(0)}`);

                        // Save combined WAV file every 10 seconds for verification
                        if (elapsedMs >= 10000 && audioChunks.length > 0) {
                            const completeBuffer = Buffer.concat(audioChunks);
                            const wavHeader = createWavHeader(completeBuffer.length, currentSampleRate);
                            const wavFile = Buffer.concat([wavHeader, completeBuffer]);
                            
                            const filename = join(TEMP_DIR, `combined_${chunkCounter}_${currentSampleRate}hz_${sampleCount}samples_${Date.now()}.wav`);
                            await Bun.write(filename, wavFile);
                            console.log(`Saved 10-second WAV file: ${filename} (${audioChunks.length} chunks, ${sampleCount} samples)`);
                            
                            // Clear chunks after saving
                            audioChunks = [];
                            sampleCount = 0;
                            lastSaveTime = now;
                        }

                        ws.send('Audio chunk validated and processed');
                    } catch (error) {
                        console.error('Error processing audio chunk:', error);
                        ws.send('Error processing audio chunk');
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
                if (audioChunks.length > 0) {
                    // Combine all PCM chunks
                    const completeBuffer = Buffer.concat(audioChunks);
                    console.log(`Complete audio recording size: ${completeBuffer.length} bytes`);
                    
                    // Optionally save or process the complete recording
                    // await Bun.write(`recording_${Date.now()}.raw`, completeBuffer);
                    
                    audioChunks = [];
                }
            },
        }
    })
);

export default {
    fetch: app.fetch,
    websocket,
};
