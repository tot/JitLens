import { Gear } from "@phosphor-icons/react";

import { Page } from "@/utils/types";

import { usePage } from "../../stores/pageStore";
import styles from "./Header.module.scss";

const Header = () => {
    const { setPage } = usePage();
    return (
        <header className={styles.header}>
            <div className={styles.headerText}>
                <h1 className={styles.title}>Notetion</h1>
                <p className={styles.version}>0.1</p>
            </div>
            <button
                className={styles.iconButton}
                onClick={() => {
                    setPage(Page.SETTINGS);
                }}>
                <Gear className={styles.icon} />
            </button>
        </header>
    );
};

export default Header;
