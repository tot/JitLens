let capture;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "takeScreenshot") {
        captureScreenshot().then((screenshot) => sendResponse({ success: true, screenshot }));
        return true; // Keep the message channel open for async response
    } else if (message.type === "startCapture") {
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
                    sendResponse({ success: false, error: "Failed to capture tab audio" });
                    return;
                }

                const audioContext = new AudioContext();
                const source = audioContext.createMediaStreamSource(capturedStream);

                const processor = audioContext.createScriptProcessor(4096, 1, 1);
                const analyzer = audioContext.createAnalyser();
                analyzer.fftSize = 2048;
                analyzer.smoothingTimeConstant = 0.3;

                source.connect(processor);
                processor.connect(audioContext.destination);
                source.connect(analyzer);

                processor.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcm16Data = new Int16Array(inputData.length);

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

                    chrome.runtime.sendMessage({
                        type: "audio_packet",
                        data: base64Data,
                        timestamp: Date.now(),
                    });
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
    }
});

async function captureScreenshot(): Promise<string> {
    // Find all tabs that match messenger.com
    const tabs = await chrome.tabs.query({
        url: ["*://*.messenger.com/*", "*://*.facebook.com/messages/*"],
    });

    // Find the tab that's specifically in a call (has video elements)
    let messengerTab = null;
    for (const tab of tabs) {
        if (!tab.id) continue;

        try {
            // Inject a script to check for video elements
            const [hasVideoCall] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const videoElements = document.querySelectorAll("video");
                    return videoElements.length > 0;
                },
            });

            if (hasVideoCall?.result) {
                messengerTab = tab;
                break;
            }
        } catch (error) {
            console.error(`Error checking tab ${tab.id}:`, error);
        }
    }

    if (!messengerTab?.id || !messengerTab.windowId) {
        throw new Error("No active Messenger video call found. Please make sure you're in a call.");
    }

    try {
        // Capture the messenger tab
        const dataUrl = await chrome.tabs.captureVisibleTab(messengerTab.windowId, {
            format: "png",
        });

        // Verify that we got a valid data URL
        if (!dataUrl.startsWith("data:image/png;base64,")) {
            throw new Error("Invalid screenshot format");
        }

        return dataUrl.slice("data:image/png;base64,".length);
    } catch (error) {
        console.error("Screenshot capture error:", error);
        throw error;
    }
}
