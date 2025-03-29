import WebSocket from "ws";

const socket = new WebSocket("ws://localhost:8765");

socket.onopen = () => {
    console.log("Connected to Python WebSocket");
    socket.send("Hello from JavaScript!");
};

socket.onmessage = (event) => {
    console.log("Received from Python: ${event.data}");
};