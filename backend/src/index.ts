import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { spawn } from "bun";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { Readable } from "stream";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

// Ensure temp directory exists
const TEMP_DIR = "./temp";
mkdir(TEMP_DIR).catch(() => {});

// WAV header size in bytes
const WAV_HEADER_SIZE = 44;

// Function to convert WAV buffer to PCM16
function wavToPcm16(wavBuffer: Buffer): Buffer {
    // Skip WAV header and return raw PCM data
    return wavBuffer.subarray(WAV_HEADER_SIZE);
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
                        
                        // Convert WAV chunk to PCM16
                        const pcmChunk = wavToPcm16(chunk);
                        
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
