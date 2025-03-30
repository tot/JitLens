import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

app.get("/", (c) => {
    return c.text("Hello Hono!");
});

app.get(
    '/ws',
    upgradeWebSocket((c) => {
        let audioChunks: Blob[] = [];
        
        return {
            onOpen() {
                console.log("Connection opened on /ws");
                audioChunks = [];
            },
            async onMessage(event, ws) {
                // Check if the message is binary (audio data) or text (screenshot)
                if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
                    // Handle WebM audio chunk
                    const chunk = event.data instanceof ArrayBuffer ? new Blob([event.data]) : event.data;
                    audioChunks.push(chunk);
                    console.log(`Received audio chunk, size: ${chunk.size} bytes`);
                    
                    // Here you can:
                    // 1. Save chunks to file
                    // 2. Forward to another service
                    // 3. Process audio
                    // etc.
                    
                    ws.send('Audio chunk received');
                } else {
                    // Handle text messages (like screenshots)
                    try {
                        const message = JSON.parse(event.data.toString());
                        if (message.type === 'screenshot') {
                            console.log("Received screenshot data");
                            // Extract base64 data from data URL
                            const base64Data = message.data.replace(/^data:image\/\w+;base64,/, '');
                            // Convert base64 to buffer
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
                // Optionally save or process the complete audio recording
                if (audioChunks.length > 0) {
                    const completeBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                    console.log(`Complete audio recording size: ${completeBlob.size} bytes`);
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
