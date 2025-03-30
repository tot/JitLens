import { atom, useAtom } from "jotai";

import { Page } from "@/utils/types";

export const pageAtom = atom<Page>(Page.ADD);

export const usePage = () => {
    const [currentPage, setPage] = useAtom(pageAtom);

    return { currentPage, setPage };
};
