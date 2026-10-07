import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TradeTechPro from "./TradeTechPro.jsx";

createRoot(document.getElementById("root")).render(<TradeTechPro />);

// Register the push service worker (notifications only; no offline caching).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* push just won't be available */ });
  });
}
