import React from "react";
import ReactDOM from "react-dom/client";
// Caveat: the handwriting font for the user's notes (bundled locally, offline).
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/600.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
