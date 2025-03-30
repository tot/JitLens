// Remove WebSocket connection code since we'll use Chrome messaging
async function captureAndSendVideoFrame() {
    try {
        // Find video element with display: block style
        const videos = document.querySelectorAll("video");
        const videoElement = Array.from(videos).find((video) => {
            const style = window.getComputedStyle(video);
            return style.display === "block";
        });

        console.log("[JitLens] Video element:", videoElement);

        if (!videoElement) {
            console.warn("[JitLens] No video element with display:block found in the page");
            return;
        }

        // Create a canvas element
        const canvas = document.createElement("canvas");
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;

        // Draw the video frame to canvas
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.error("[JitLens] Could not get canvas context");
            return;
        }
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Convert to base64
        const base64Data = canvas.toDataURL("image/png").split(",")[1];

        // Send to extension via Chrome message
        chrome.runtime.sendMessage({
            type: "video_frame",
            data: base64Data,
            timestamp: Date.now(),
        });
        console.log("[JitLens] Video screenshot captured and sent to extension");
    } catch (err) {
        console.error("[JitLens] Error taking screenshot:", err);
    }
}

// Start capturing frames every 5 seconds when we detect a video element
const observer = new MutationObserver(() => {
    const videos = document.querySelectorAll("video");
    const hasDisplayBlockVideo = Array.from(videos).some((video) => {
        const style = window.getComputedStyle(video);
        return style.display === "block";
    });

    if (hasDisplayBlockVideo) {
        observer.disconnect();
        setInterval(captureAndSendVideoFrame, 5000);
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
});
