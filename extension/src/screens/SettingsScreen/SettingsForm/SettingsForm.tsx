import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/Form/Form";
import { Input } from "@/components/Input/Input";
import { STORAGE_KEY_WORKSPACE_SECRET } from "@/utils/constants";

import styles from "./SettingsForm.module.scss";

const formSchema = z.object({
    workspaceSecret: z.string(),
});

const SettingsForm = () => {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            workspaceSecret: "",
        },
    });

    function onSubmit(values: z.infer<typeof formSchema>) {
        console.log(values);
        chrome.storage.sync.set({ [STORAGE_KEY_WORKSPACE_SECRET]: values.workspaceSecret });
    }

    useEffect(() => {
        const getSavedWorkspace = async () => {
            chrome.storage.sync.get([STORAGE_KEY_WORKSPACE_SECRET], (result) => {
                if (result[STORAGE_KEY_WORKSPACE_SECRET]) {
                    form.setValue("workspaceSecret", result[STORAGE_KEY_WORKSPACE_SECRET]);
                }
            });
        };

        getSavedWorkspace();
    }, [form]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className={styles.form}>
                <FormField
                    control={form.control}
                    name="workspaceSecret"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Workspace Secret</FormLabel>
                            <FormControl>
                                <Input type="password" placeholder="secret_SAMPLE1234" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className={styles.buttonContainer}>
                    <button className={styles.resetButton}>Reset</button>
                    <button className={styles.saveButton} type="submit">
                        Save settings
                    </button>
                </div>
            </form>
        </Form>
    );
};

export default SettingsForm;
