import styles from "./CallScreen.module.scss";
import { useState, useRef, useEffect } from "react";

const CallScreen = () => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string>("");
    const [logs, setLogs] = useState<string[]>([]);
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const [workletNode, setWorkletNode] = useState<AudioWorkletNode | null>(null);
    const audioContainerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        // Connect to websocket
        const ws = new WebSocket("ws://localhost:3000/ws");
        ws.onopen = () => {
            addLog("WebSocket connection established for screenshot");
        };

        ws.onmessage = (event) => {
            addLog(`Message from server: ${event.data}`);
        };

        ws.onclose = () => {
            addLog("WebSocket connection closed");
        };

        wsRef.current = ws;

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (workletNode) {
                workletNode.disconnect();
            }
            if (audioContext) {
                audioContext.close();
            }
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [workletNode, audioContext, stream]);

    const addLog = (message: string) => {
        setLogs((prevLogs) => [...prevLogs, `[${new Date().toLocaleTimeString()}] ${message}`]);
        // Auto-scroll to bottom of log container
        if (audioContainerRef.current) {
            audioContainerRef.current.scrollTop = audioContainerRef.current.scrollHeight;
        }
    };

    const startCapture = async () => {
        try {
            // Check if we're on messenger.com
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.id || !tab.url) return;

            // if (!tab.url.includes("messenger.com")) {
            //     setError("Please navigate to messenger.com to capture audio");
            //     addLog("Error: Not on messenger.com");
            //     return;
            // }

            addLog("Starting audio capture...");

            // Create a new AudioContext
            const context = new AudioContext();
            setAudioContext(context);

            // Load and register our audio worklet
            await context.audioWorklet.addModule(
                chrome.runtime.getURL("src/audio/pcm-processor.js")
            );

            // Capture the tab audio
            chrome.tabCapture.capture(
                {
                    audio: true,
                    video: false,
                    audioConstraints: {
                        mandatory: {
                            chromeMediaSource: "tab",
                        },
                    },
                },
                async (capturedStream) => {
                    if (!capturedStream) {
                        setError("Failed to capture tab audio");
                        addLog("Error: Failed to capture tab audio");
                        return;
                    }

                    setStream(capturedStream);
                    addLog("Successfully captured audio stream");

                    // Create audio source from the captured stream
                    const source = context.createMediaStreamSource(capturedStream);

                    // Create analyzer for audio levels
                    const analyzer = context.createAnalyser();
                    source.connect(analyzer);

                    // Create and connect the worklet node
                    const node = new AudioWorkletNode(context, "pcm-processor");
                    setWorkletNode(node);
                    source.connect(node);
                    node.connect(context.destination);

                    // Handle PCM data from the worklet
                    node.port.onmessage = (event) => {
                        if (
                            event.data.type === "pcm-data" &&
                            wsRef.current?.readyState === WebSocket.OPEN
                        ) {
                            wsRef.current?.send(event.data.data);
                        }
                    };

                    // Log audio levels to verify capture is working
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                    const checkAudio = () => {
                        analyzer.getByteFrequencyData(dataArray);
                        const audioLevel = dataArray.reduce((a, b) => a + b) / dataArray.length;
                        addLog(`Audio Level: ${audioLevel.toFixed(2)}`);
                    };
                    setInterval(checkAudio, 1000);
                }
            );
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
            setError(errorMessage);
            addLog(`Error: ${errorMessage}`);
            console.error("Error capturing tab audio:", err);
        }
    };

    const stopCapture = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (workletNode) {
            workletNode.disconnect();
            setWorkletNode(null);
        }
        if (audioContext) {
            audioContext.close();
            setAudioContext(null);
        }
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
        }
        addLog("Audio capture stopped");
    };

    const clearError = () => {
        setError("");
    };

    const clearLogs = () => {
        setLogs([]);
    };

    const takeScreenshot = async () => {
        try {
            addLog("Taking screenshot...");
            chrome.runtime.sendMessage({ type: "takeScreenshot" }, (response) => {
                if (chrome.runtime.lastError) {
                    const error = chrome.runtime.lastError.message || "Unknown error";
                    setError(error);
                    addLog(`Screenshot error: ${error}`);
                    return;
                }

                if (response.success) {
                    addLog("Screenshot captured and sent to server");
                } else {
                    const error = response.error || "Failed to capture screenshot";
                    setError(error);
                    addLog(`Screenshot error: ${error}`);
                }
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
            setError(errorMessage);
            addLog(`Screenshot error: ${errorMessage}`);
            console.error("Error taking screenshot:", err);
        }
    };

    return (
        <div className={styles.screen}>
            <div className={styles.container}>
                <button onClick={startCapture}>Start Audio Capture</button>
                <button onClick={stopCapture}>Stop Audio Capture</button>
                <button onClick={clearError}>Clear Error</button>
                <button onClick={clearLogs}>Clear Logs</button>
                <button onClick={takeScreenshot}>Take Screenshot</button>

                {stream && <div>Audio capture active!</div>}
                {error && <div className={styles.error}>{error}</div>}

                <div ref={audioContainerRef} className={styles.audioContainer} id="audioContainer">
                    {logs.map((log, index) => (
                        <div key={index} className={styles.logEntry}>
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CallScreen;
