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

// Convert WebM to PCM16 using FFmpeg
async function convertToPCM16(inputBuffer: Buffer): Promise<Buffer> {
    const tempInput = join(TEMP_DIR, `input_${Date.now()}.webm`);
    const tempOutput = join(TEMP_DIR, `output_${Date.now()}.raw`);

    try {
        // Write input buffer to temp file
        await Bun.write(tempInput, inputBuffer);

        // Run FFmpeg conversion
        const ffmpeg = spawn([
            "ffmpeg",
            "-i", tempInput,
            "-f", "s16le",  // PCM 16-bit little-endian
            "-acodec", "pcm_s16le",
            "-ar", "16000", // 16kHz sample rate
            "-ac", "1",     // mono
            tempOutput
        ], {
            stderr: "pipe"
        });

        const output = await ffmpeg.exited;
        
        if (output !== 0) {
            const stderrOutput = await new Response(ffmpeg.stderr).text();
            throw new Error(`FFmpeg conversion failed: ${stderrOutput}`);
        }

        // Read the converted PCM data
        const pcmData = await Bun.file(tempOutput).arrayBuffer();
        return Buffer.from(pcmData);
    } finally {
        // Cleanup temp files
        await Promise.all([
            rm(tempInput).catch(() => {}),
            rm(tempOutput).catch(() => {})
        ]);
    }
}

// Convert WebM to G711 µ-law using FFmpeg
async function convertToG711ULaw(inputBuffer: Buffer): Promise<Buffer> {
    const tempInput = join(TEMP_DIR, `input_${Date.now()}.webm`);
    const tempOutput = join(TEMP_DIR, `output_${Date.now()}.ul`);

    try {
        await Bun.write(tempInput, inputBuffer);

        const ffmpeg = spawn([
            "ffmpeg",
            "-i", tempInput,
            "-f", "mulaw",
            "-acodec", "pcm_mulaw",
            "-ar", "8000", // G.711 uses 8kHz
            "-ac", "1",    // mono
            tempOutput
        ], {
            stderr: "pipe"
        });

        const output = await ffmpeg.exited;
        
        if (output !== 0) {
            const stderrOutput = await new Response(ffmpeg.stderr).text();
            throw new Error(`FFmpeg conversion failed: ${stderrOutput}`);
        }

        const ulawData = await Bun.file(tempOutput).arrayBuffer();
        return Buffer.from(ulawData);
    } finally {
        await Promise.all([
            rm(tempInput).catch(() => {}),
            rm(tempOutput).catch(() => {})
        ]);
    }
}

app.get("/", (c) => {
    return c.text("Hello Hono!");
});

app.get(
    '/ws',
    upgradeWebSocket((c) => {
        let audioChunks: Buffer[] = [];
        
        return {
            onOpen() {
                console.log("Connection opened on /ws");
                audioChunks = [];
            },
            async onMessage(event, ws) {
                // Check if the message is binary (audio data) or text (screenshot)
                if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
                    try {
                        // Convert incoming data to Buffer
                        const chunk = Buffer.from(
                            event.data instanceof Blob ? 
                            await event.data.arrayBuffer() : 
                            event.data
                        );
                        
                        // Convert the chunk to PCM16
                        const pcmChunk = await convertToPCM16(chunk);
                        // Alternatively, use G.711 µ-law:
                        // const ulawChunk = await convertToG711ULaw(chunk);
                        
                        // Store the converted chunk
                        audioChunks.push(pcmChunk);
                        
                        console.log(`Received and converted audio chunk, size: ${pcmChunk.length} bytes`);
                        
                        // Here you can:
                        // 1. Send the converted chunk to your speech-to-text service
                        // 2. Save to file
                        // 3. Process further
                        
                        ws.send('Audio chunk received and converted');
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
