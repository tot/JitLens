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
    // Get the active tab and window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.windowId) {
        throw new Error("No active tab found");
    }

    // Capture the visible tab
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 80,
    });

    return screenshot;
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
