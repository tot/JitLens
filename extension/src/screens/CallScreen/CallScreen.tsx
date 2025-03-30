import styles from "./CallScreen.module.scss";
import { useState, useRef, useEffect } from "react";

const CallScreen = () => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string>("");
    const [logs, setLogs] = useState<string[]>([]);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContainerRef = useRef<HTMLDivElement>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const wavConfigRef = useRef<{
        sampleRate: number;
        bitsPerSample: number;
        channels: number;
    } | null>(null);
    const headerAcknowledgedRef = useRef<boolean>(false);

    const connectWebSocket = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        const ws = new WebSocket("ws://localhost:3000/ws");

        ws.onopen = () => {
            addLog("WebSocket connection established");
            // Resend WAV header if we have it
            if (wavConfigRef.current) {
                ws.send(
                    JSON.stringify({
                        type: "wav_header",
                        ...wavConfigRef.current,
                    })
                );
                addLog("Resent WAV header configuration");
            }
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === "wav_header_ack") {
                    headerAcknowledgedRef.current = true;
                    addLog("WAV header acknowledged by server");
                } else if (message.type === "error") {
                    addLog(`Error from server: ${message.message}`);
                } else if (message.type === "chunk_saved") {
                    addLog(`Server saved audio chunk: ${message.filename}`);
                }
            } catch (e) {
                addLog(`Message from server: ${event.data}`);
            }
        };

        ws.onclose = () => {
            addLog("WebSocket connection closed, attempting to reconnect...");
            headerAcknowledgedRef.current = false;
            setTimeout(connectWebSocket, 1000);
        };

        wsRef.current = ws;
    };

    useEffect(() => {
        connectWebSocket();
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
        if (audioContainerRef.current) {
            audioContainerRef.current.scrollTop = audioContainerRef.current.scrollHeight;
        }
    };

    const startCapture = async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.id || !tab.url) return;

            addLog("Starting audio capture...");

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

                    // Create a ScriptProcessorNode with larger buffer for better quality
                    const processor = audioContext.createScriptProcessor(4096, 1, 1);
                    processorRef.current = processor;

                    // Create analyzer for audio levels
                    const analyzer = audioContext.createAnalyser();
                    analyzer.fftSize = 2048;
                    analyzer.smoothingTimeConstant = 0.3;

                    // Connect the audio chain: source -> processor -> analyzer
                    source.connect(processor);
                    processor.connect(audioContext.destination);
                    source.connect(analyzer);

                    // Store WAV configuration
                    wavConfigRef.current = {
                        sampleRate: audioContext.sampleRate,
                        bitsPerSample: 16,
                        channels: 1,
                    };

                    // Send WAV header information and wait for confirmation
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(
                            JSON.stringify({
                                type: "wav_header",
                                ...wavConfigRef.current,
                            })
                        );
                        addLog("Sent WAV header configuration");
                    } else {
                        addLog("Error: WebSocket not connected");
                        return;
                    }

                    let isFirstChunk = true;
                    // Handle audio processing
                    processor.onaudioprocess = (e) => {
                        if (
                            wsRef.current?.readyState === WebSocket.OPEN &&
                            headerAcknowledgedRef.current
                        ) {
                            // Get PCM data from input channel
                            const inputData = e.inputBuffer.getChannelData(0);

                            // Convert Float32Array to Int16Array (PCM16) with better scaling
                            const pcm16Data = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                // Add dither noise to reduce quantization effects
                                const dither = (Math.random() * 2 - 1) * 0.0001;
                                const sample = Math.max(-1, Math.min(1, inputData[i] + dither));
                                // Scale to 16-bit range with proper rounding
                                pcm16Data[i] = Math.round(sample * 32767);
                            }

                            const timestamp = Date.now();

                            // Send chunk info first
                            wsRef.current.send(
                                JSON.stringify({
                                    type: "wav_chunk_info",
                                    timestamp,
                                    size: pcm16Data.length * 2, // 2 bytes per sample
                                    isFirstChunk,
                                })
                            );

                            // Then send the actual audio data
                            wsRef.current.send(pcm16Data.buffer);

                            if (isFirstChunk) {
                                addLog("Started sending audio chunks");
                                isFirstChunk = false;
                            }
                        } else if (!headerAcknowledgedRef.current) {
                            // Resend WAV header if not acknowledged
                            if (
                                wsRef.current?.readyState === WebSocket.OPEN &&
                                wavConfigRef.current
                            ) {
                                wsRef.current.send(
                                    JSON.stringify({
                                        type: "wav_header",
                                        ...wavConfigRef.current,
                                    })
                                );
                                addLog("Resending WAV header configuration...");
                            }
                        }
                    };

                    // Log audio levels to verify capture is working
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                    const checkAudio = () => {
                        analyzer.getByteTimeDomainData(dataArray);
                        // Calculate RMS value for better level representation
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) {
                            const amplitude = (dataArray[i] - 128) / 128;
                            sum += amplitude * amplitude;
                        }
                        const rms = Math.sqrt(sum / dataArray.length);
                        addLog(`Audio Level: ${(rms * 100).toFixed(2)}`);
                    };
                    const audioLevelInterval = setInterval(checkAudio, 1000);

                    // Store processor reference for cleanup
                    setMediaRecorder(processor as any);

                    // Clean up the interval when stopping
                    return () => {
                        clearInterval(audioLevelInterval);
                    };
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
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
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
        wavConfigRef.current = null;
        headerAcknowledgedRef.current = false;
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
