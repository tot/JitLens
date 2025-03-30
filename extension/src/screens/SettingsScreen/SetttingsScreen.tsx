import { X } from "@phosphor-icons/react";

import { usePage } from "@/stores/pageStore";
import { Page } from "@/utils/types";

import SettingsForm from "./SettingsForm/SettingsForm";
import styles from "./SettingsScreen.module.scss";

const SettingsScreen = () => {
    const { setPage } = usePage();
    return (
        <div className={styles.screen}>
            <div className={styles.container}>
                <div className={styles.titleContainer}>
                    <h1 className={styles.title}>Settings</h1>
                    <button className={styles.iconButton} onClick={() => setPage(Page.HOME)}>
                        <X className={styles.icon} />
                    </button>
                </div>
                <SettingsForm />
            </div>
        </div>
    );
};

export default SettingsScreen;
