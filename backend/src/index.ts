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
        return {
            onOpen() {
                console.log("Connection opened on /ws");
            },
            onMessage(event, ws) {
                // Check if the message is binary (PCM data) or text (screenshot)
                if (event.data instanceof ArrayBuffer) {
                    // Handle PCM audio data
                    const pcmData = new Int16Array(event.data);
                    console.log(`Received PCM audio data, length: ${pcmData.length}`);
                    
                    // Here you can process the PCM data:
                    // 1. Save to file
                    // 2. Forward to another service
                    // 3. Analyze audio
                    // etc.
                    
                    // For now, just acknowledge receipt
                    ws.send('Audio data received');
                } else {
                    // Handle text messages (like screenshots)
                    try {
                        const message = JSON.parse(event.data.toString());
                        if (message.type === 'screenshot') {
                            console.log('Received screenshot data', message.data);
                            // Process screenshot...
                            ws.send('Screenshot received');
                        }
                    } catch (error) {
                        console.error('Error parsing message:', error);
                        ws.send('Error processing message');
                    }
                }
            },
            onClose: () => {
                console.log('Connection closed');
            },
        }
    })
);

export default {
    fetch: app.fetch,
    websocket,
};
