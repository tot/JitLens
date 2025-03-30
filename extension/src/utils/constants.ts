import { BookmarkSimple, Gear } from "@phosphor-icons/react";

import { Page } from "./types";

export const NAVBAR_LINKS = [
    { page: Page.ADD, icon: BookmarkSimple },
    { page: Page.SETTINGS, icon: Gear },
];

export const STORAGE_KEY_WORKSPACE_SECRET = "notetion.workspaceSecret";
