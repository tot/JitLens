import styles from "./CallScreen.module.scss";
import { useState, useRef, useEffect } from "react";

const CallScreen = () => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string>("");
    const [logs, setLogs] = useState<string[]>([]);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContainerRef = useRef<HTMLDivElement>(null);

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
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [stream]);

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

            addLog("Starting audio capture...");

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

                    // Create audio context with original sample rate for better quality
                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(capturedStream);

                    // Log the actual sample rate
                    addLog(`Audio context sample rate: ${audioContext.sampleRate}Hz`);

                    // Create a ScriptProcessorNode for raw PCM data
                    const processor = audioContext.createScriptProcessor(2048, 1, 1);

                    // Connect only source -> processor (don't connect to destination to avoid feedback)
                    source.connect(processor);

                    // Handle audio processing
                    processor.onaudioprocess = (e) => {
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            // Get PCM data from input channel
                            const inputData = e.inputBuffer.getChannelData(0);

                            // Convert Float32Array to Int16Array (PCM16) with better scaling
                            const pcm16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                // Improved conversion with proper scaling and dithering
                                const sample = inputData[i];
                                // Add small amount of dither noise to reduce quantization effects
                                const dither = (Math.random() * 2 - 1) * 0.1;
                                const scaled = (sample + dither) * 32768.0;
                                // Proper rounding and clamping
                                pcm16Data[i] = Math.max(
                                    -32768,
                                    Math.min(32767, Math.round(scaled))
                                );
                            }

                            // Send audio data with sample rate info
                            const message = {
                                type: "audio",
                                sampleRate: audioContext.sampleRate,
                                data: pcm16Data.buffer,
                            };
                            wsRef.current.send(
                                JSON.stringify({
                                    type: "audio_info",
                                    sampleRate: audioContext.sampleRate,
                                })
                            );
                            wsRef.current.send(pcm16Data.buffer);
                        }
                    };

                    // Create analyzer for audio levels (after processor to monitor processed audio)
                    const analyzer = audioContext.createAnalyser();
                    processor.connect(analyzer);

                    // Log audio levels to verify capture is working
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                    const checkAudio = () => {
                        analyzer.getByteFrequencyData(dataArray);
                        const audioLevel = dataArray.reduce((a, b) => a + b) / dataArray.length;
                        addLog(`Audio Level: ${audioLevel.toFixed(2)}`);
                    };
                    setInterval(checkAudio, 1000);

                    // Store processor reference for cleanup
                    setMediaRecorder(processor as any);
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
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
        }
        setMediaRecorder(null);
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
