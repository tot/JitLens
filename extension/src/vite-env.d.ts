/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly PY_BACKEND_URL: string;
    readonly HONO_BACKEND_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
