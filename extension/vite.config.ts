import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react-swc";
import jotaiDebugLabel from "jotai/babel/plugin-debug-label";
import jotaiReactRefresh from "jotai/babel/plugin-react-refresh";
// @ts-ignore
import { fileURLToPath } from "url";
// @ts-ignore
import { resolve, dirname } from "path";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { manifest } from "./src/manifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
    resolve: {
        alias: {
            "@styles": resolve(__dirname, "src/styles"),
        },
    },
    build: {
        rollupOptions: {
            input: {
                "main": resolve(__dirname, "index.html"),
                "pcm-processor": resolve(__dirname, "src/audio/pcm-processor.ts"),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    return chunkInfo.name === "pcm-processor"
                        ? "src/audio/[name].js"
                        : "assets/[name]-[hash].js";
                },
            },
        },
    },
    plugins: [
        // @ts-expect-error babel property is not defined but necessary per Jotai documentation
        react({ babel: { plugins: [jotaiDebugLabel, jotaiReactRefresh] } }),
        tsconfigPaths(),
        crx({ manifest }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
        watch: {
            // During development, vite only needs to watch your project's source files
            ignored: ["**/node_modules/**"],
        },
    },
});
