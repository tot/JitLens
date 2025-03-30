import "../index.css";

import React from "react";
import ReactDOM from "react-dom/client";

const root = document.createElement("div");
root.id = "notetion-root";
document.body.appendChild(root);

ReactDOM.createRoot(root).render(<React.StrictMode>{/* <Integration /> */}</React.StrictMode>);
