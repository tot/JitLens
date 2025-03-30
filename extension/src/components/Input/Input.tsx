import { Eye, EyeSlash } from "@phosphor-icons/react";
import clsx from "clsx";
import * as React from "react";
import { useState } from "react";

import styles from "./Input.module.scss";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    type?: "text" | "password" | "email";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        const [showPassword, setShowPassword] = useState(false);

        if (type === "password") {
            return (
                <div className={styles.passwordWrapper}>
                    <button
                        type="button"
                        className={styles.showPasswordButton}
                        onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? (
                            <EyeSlash className={styles.showIcon} />
                        ) : (
                            <Eye className={styles.showIcon} />
                        )}
                    </button>
                    <input
                        type={showPassword ? "text" : "password"}
                        className={clsx(styles.password, className)}
                        ref={ref}
                        {...props}
                    />
                </div>
            );
        }
        return (
            <input type={type} className={clsx(styles.default, className)} ref={ref} {...props} />
        );
    }
);
Input.displayName = "Input";

export { Input };
