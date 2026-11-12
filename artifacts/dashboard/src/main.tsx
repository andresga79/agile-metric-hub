import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import App from "./App";
import "./index.css";
import "./lib/i18n";

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<div className="min-h-screen bg-background text-foreground flex items-center justify-center">Cargando...</div>}>
    <App />
  </Suspense>
);
