import React from "react";
import "./App.scss";

// import AppLayout from "@/layouts/AppLayout/AppLayout";
import CallScreen from "@/screens/CallScreen/CallScreen";
import ReactDOM from "react-dom/client";

const root = document.createElement("div");
root.id = "jitlens-root";
root.style.position = "fixed";
root.style.top = "0";
root.style.left = "0";
root.style.width = "200px";
root.style.height = "200px";
document.body.appendChild(root);

console.log("JitLens content script loaded");

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <CallScreen />
    </React.StrictMode>
);
