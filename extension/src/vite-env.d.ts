/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_NOTION_INTEGRATION: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
