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

    const connectWebSocket = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        const ws = new WebSocket(import.meta.env.HONO_BACKEND_URL);

        ws.onopen = () => {
            addLog("WebSocket connection established");
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === "error") {
                    addLog(`Error from server: ${message.message}`);
                }
            } catch (e) {
                addLog(`Message from server: ${event.data}`);
            }
        };

        ws.onclose = () => {
            addLog("WebSocket connection closed, attempting to reconnect...");
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

    const createWavHeader = (
        dataLength: number,
        sampleRate: number,
        channels: number,
        bitsPerSample: number
    ) => {
        const buffer = new ArrayBuffer(44);
        const view = new DataView(buffer);

        // RIFF chunk descriptor
        view.setUint8(0, "R".charCodeAt(0));
        view.setUint8(1, "I".charCodeAt(0));
        view.setUint8(2, "F".charCodeAt(0));
        view.setUint8(3, "F".charCodeAt(0));
        view.setUint32(4, 36 + dataLength, true);
        view.setUint8(8, "W".charCodeAt(0));
        view.setUint8(9, "A".charCodeAt(0));
        view.setUint8(10, "V".charCodeAt(0));
        view.setUint8(11, "E".charCodeAt(0));

        // fmt sub-chunk
        view.setUint8(12, "f".charCodeAt(0));
        view.setUint8(13, "m".charCodeAt(0));
        view.setUint8(14, "t".charCodeAt(0));
        view.setUint8(15, " ".charCodeAt(0));
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
        view.setUint16(32, channels * (bitsPerSample / 8), true);
        view.setUint16(34, bitsPerSample, true);

        // data sub-chunk
        view.setUint8(36, "d".charCodeAt(0));
        view.setUint8(37, "a".charCodeAt(0));
        view.setUint8(38, "t".charCodeAt(0));
        view.setUint8(39, "a".charCodeAt(0));
        view.setUint32(40, dataLength, true);

        return buffer;
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

                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(capturedStream);
                    addLog(`Audio context sample rate: ${audioContext.sampleRate}Hz`);

                    const processor = audioContext.createScriptProcessor(4096, 1, 1);
                    processorRef.current = processor;

                    const analyzer = audioContext.createAnalyser();
                    analyzer.fftSize = 2048;
                    analyzer.smoothingTimeConstant = 0.3;

                    source.connect(processor);
                    processor.connect(audioContext.destination);
                    source.connect(analyzer);

                    processor.onaudioprocess = (e) => {
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcm16Data = new Int16Array(inputData.length);

                            // Convert to 16-bit PCM with dithering
                            for (let i = 0; i < inputData.length; i++) {
                                const dither = (Math.random() * 2 - 1) * 0.0001;
                                const sample = Math.max(-1, Math.min(1, inputData[i] + dither));
                                pcm16Data[i] = Math.round(sample * 32767);
                            }

                            // Create WAV header
                            const wavHeader = createWavHeader(
                                pcm16Data.byteLength,
                                audioContext.sampleRate,
                                1,
                                16
                            );

                            // Combine header and audio data
                            const fullWavData = new Uint8Array(
                                wavHeader.byteLength + pcm16Data.byteLength
                            );
                            fullWavData.set(new Uint8Array(wavHeader), 0);
                            fullWavData.set(new Uint8Array(pcm16Data.buffer), wavHeader.byteLength);

                            // Convert to base64
                            const base64Data = btoa(
                                String.fromCharCode.apply(null, Array.from(fullWavData))
                            );

                            // Send the audio packet
                            wsRef.current.send(
                                JSON.stringify({
                                    type: "audio_packet",
                                    timestamp: Date.now(),
                                    data: `data:audio/wav;base64,${base64Data}`,
                                })
                            );
                        }
                    };

                    // Log audio levels
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                    const checkAudio = () => {
                        analyzer.getByteTimeDomainData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) {
                            const amplitude = (dataArray[i] - 128) / 128;
                            sum += amplitude * amplitude;
                        }
                        const rms = Math.sqrt(sum / dataArray.length);
                        addLog(`Audio Level: ${(rms * 100).toFixed(2)}`);
                    };
                    const audioLevelInterval = setInterval(checkAudio, 1000);

                    setMediaRecorder(processor as any);

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
