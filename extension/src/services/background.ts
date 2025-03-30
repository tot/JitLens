chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "linkOpenInNewTab",
        title: "Check this link",
        contexts: ["link"], // This makes the menu item appear only for links
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "linkOpenInNewTab") {
        console.log("Link URL:", info.linkUrl);
        // Perform actions or further checks
        // Example: Check if the context menu was triggered with a right click
        //   if (info.button === 2) {  // Right-click is usually the button 2
        // 	console.log("Opened via right click");
        //   }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "takeScreenshot") {
        captureScreenshot()
            .then((screenshot) => {
                // Send screenshot to WebSocket server
                const ws = new WebSocket("ws://localhost:3000/ws");
                ws.onopen = () => {
                    ws.send(
                        JSON.stringify({
                            type: "screenshot",
                            data: screenshot,
                        })
                    );
                    ws.close();
                    sendResponse({ success: true });
                };
                ws.onerror = (error) => {
                    console.error("WebSocket error:", error);
                    sendResponse({ success: false, error: "WebSocket error" });
                };
            })
            .catch((error) => {
                console.error("Screenshot error:", error);
                sendResponse({ success: false, error: error.message });
            });
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

        return dataUrl;
    } catch (error) {
        console.error("Screenshot capture error:", error);
        throw error;
    }
}

// chrome.runtime.onStartup.addListener(async () => {
//     const val = await chrome.storage.sync.get(["NOTION_DATABASE_ID"]);
//     console.log("Value is", val);
// });

// chrome.bookmarks.getRecent(10, (results) => {
//     console.log(`bookmarks:`, results);
// });

// console.log(`this is background service worker`);

// Example of a simple event listener
//   chrome.alarms.onAlarm.addListener((alarm) => {
// 	console.log('Alarm triggered:', alarm);
//   });

//   // Example of using the storage API
//   chrome.storage.local.set({key: value}, function() {
// 	console.log('Value is set to ' + value);
//   });
