import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CallScreen.module.scss";

const CallScreen = () => {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string>("");
    const [logs, setLogs] = useState<string[]>([]);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContainerRef = useRef<HTMLDivElement>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);

    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        const ws = new WebSocket("ws://localhost:8000/ws");

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
    }, []);

    useEffect(() => {
        connectWebSocket();

        return () => {
            wsRef.current?.close();
        };
    }, [connectWebSocket]);

    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [stream]);

    const addLog = useCallback((message: string) => {
        setLogs((prevLogs) => [...prevLogs, `[${new Date().toLocaleTimeString()}] ${message}`]);
        if (audioContainerRef.current) {
            audioContainerRef.current.scrollTop = audioContainerRef.current.scrollHeight;
        }
    }, []);

    const startCapture = async () => {
        try {
            addLog("Starting audio capture...");

            const capturedStream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
            });
            if (!capturedStream) {
                setError("Failed to capture tab audio");
                addLog("Error: Failed to capture tab audio");
                return;
            }

            console.log("AudioTracks:", capturedStream.getAudioTracks());

            setStream(capturedStream);
            addLog("Successfully captured audio stream");

            const audioContext = new AudioContext({ sampleRate: 48000 });
            const source = audioContext.createMediaStreamSource(capturedStream);
            addLog(`Audio context sample rate: ${audioContext.sampleRate}Hz`);

            console.log("Sample rate:", audioContext.sampleRate);

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

                    // Calculate RMS sound level
                    let sum = 0;
                    for (let i = 0; i < inputData.length; i++) {
                        sum += inputData[i] * inputData[i];
                    }
                    const rms = Math.sqrt(sum / inputData.length);
                    const soundLevel = (rms * 100).toFixed(2);

                    // Convert to 16-bit PCM with dithering
                    for (let i = 0; i < inputData.length; i++) {
                        const dither = (Math.random() * 2 - 1) * 0.0001;
                        const sample = Math.max(-1, Math.min(1, inputData[i] + dither));
                        pcm16Data[i] = Math.round(sample * 32767);
                    }

                    // Combine header and audio data
                    const fullWavData = new Uint8Array(pcm16Data.byteLength);
                    fullWavData.set(new Uint8Array(pcm16Data.buffer), 0);

                    // Convert to base64
                    const base64Data = btoa(
                        String.fromCharCode.apply(null, Array.from(fullWavData))
                    );

                    // Send the audio packet with sound level
                    wsRef.current.send(
                        JSON.stringify({
                            type: "audio_packet",
                            timestamp: Date.now(),
                            data: base64Data,
                            sound_level: parseFloat(soundLevel),
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

    return (
        <div className={styles.screen}>
            <div className={styles.container}>
                <button onClick={startCapture}>Start Audio Capture</button>
                <button onClick={stopCapture}>Stop Audio Capture</button>
                <button onClick={clearError}>Clear Error</button>
                <button onClick={clearLogs}>Clear Logs</button>

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
