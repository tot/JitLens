import type { ManifestV3Export } from "@crxjs/vite-plugin";

export const manifest: ManifestV3Export = {
    manifest_version: 3,
    name: "jitlens",
    version: "1.0.0",
    action: { default_popup: "index.html" },
    permissions: ["storage", "tabs", "contextMenus", "activeTab", "tabCapture", "scripting"],
    background: {
        service_worker: "src/services/background.ts",
        type: "module",
    },
    web_accessible_resources: [
        {
            resources: ["assets/*", "src/audio/*"],
            matches: ["<all_urls>"],
        },
    ],
    host_permissions: [
        "ws://localhost:3000/*",
        "*://*.youtube.com/*",
        "*://*.messenger.com/*",
        "*://*.facebook.com/*",
        // "chrome://*/*",
        "<all_urls>",
    ],
} as const;
