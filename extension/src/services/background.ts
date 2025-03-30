// Listen for messages from videoCapture.ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "video_frame") {
        // Forward the message to all tabs with CallScreen
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
                // Use Paulgraham website for injecting CallScreen
                if (tab.id && tab.url?.includes("paulgraham.com")) {
                    chrome.tabs.sendMessage(tab.id, message);
                }
            });
        });
    }
    return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "takeScreenshot") {
        captureScreenshot().then((screenshot) => sendResponse({ success: true, screenshot }));
        return true; // Keep the message channel open for async response
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
