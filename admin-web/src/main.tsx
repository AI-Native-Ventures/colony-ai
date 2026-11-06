import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AdminErrorBoundary } from "./admin-error-boundary";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");
createRoot(root).render(
  <StrictMode>
    <AdminErrorBoundary>
      <App />
    </AdminErrorBoundary>
  </StrictMode>,
);
