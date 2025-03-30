import { ReactNode } from "react";

import Header from "@/components/Header/Header";

import styles from "./AppLayout.module.scss";

interface AppLayoutProps {
    children: ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
    return (
        <div className={styles.container}>
            <Header />
            <main className={styles.content}>{children}</main>
        </div>
    );
};

export default AppLayout;
