import WebSocket from 'ws';
import fs from 'fs';
import { Writable } from 'stream';

// Define the API key and model
const apiKey = process.env.API_KEY;  // Replace with your actual API key
const model = "gemini-2.0-flash-exp";

// Configuration for response modalities
const config = {
  response_modalities: ["AUDIO"]
};

// WebSocket URL from Gemini (assuming this is the correct URL for live communication)
const url = `wss://api.gemini.com/live`;  // Replace with the correct Gemini WebSocket endpoint

// Function to connect to Gemini WebSocket
async function connectToGemini() {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`, // Authentication (bearer token or API key)
      }
    });

    ws.on('open', () => {
      console.log("Connection established with Gemini API");
      resolve(ws);
    });

    ws.on('error', (err) => {
      reject(`WebSocket error: ${err}`);
    });
  });
}

// Create a writable stream for the audio file
function createAudioStream() {
  const fileStream = fs.createWriteStream('audio.wav');
  return fileStream;
}

// Main function
async function main() {
  try {
    const ws = await connectToGemini();

    // Create the audio file stream
    const audioStream = createAudioStream();

    // Send model and config as the initial message
    const initMessage = {
      model: model,
      config: config
    };
    ws.send(JSON.stringify(initMessage));

    // Listen for user input and send messages to Gemini API
    process.stdin.on('data', (data) => {
      const message = data.toString().trim();

      if (message.toLowerCase() === "exit") {
        ws.close();
        console.log("Exiting...");
        return;
      }

      const inputMessage = {
        input: message,
        end_of_turn: true,
      };

      ws.send(JSON.stringify(inputMessage));

      // Listen for responses from the API
      ws.on('message', (response) => {
        try {
          const parsedResponse = JSON.parse(response.toString());

          // Check if the response contains audio data
          if (parsedResponse.data) {
            // Write the binary audio data to the file
            audioStream.write(Buffer.from(parsedResponse.data, 'base64'));
            console.log("Writing audio data...");
          }
        } catch (err) {
          console.error("Error parsing response:", err);
        }
      });
    });
  } catch (err) {
    console.error("Error connecting to Gemini API:", err);
  }
}

main();
