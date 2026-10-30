import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// 구버전이 localStorage에 평문으로 남긴 Deep AI API 키 정리
try {
  const raw = localStorage.getItem("agentrix_deep_ai_config");
  if (raw) {
    const { apiKey: _drop, ...rest } = JSON.parse(raw);
    localStorage.setItem("agentrix_deep_ai_config", JSON.stringify(rest));
  }
} catch {}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
