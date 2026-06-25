import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import { CurrencyProvider } from "./contexts/CurrencyContext.js";
import { captureRefFromUrl } from "./lib/ref.js";
import "./index.css";

// Persist ?ref BEFORE the first render so auth links carry it on the landing visit.
captureRefFromUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <CurrencyProvider>
        <App />
      </CurrencyProvider>
    </BrowserRouter>
  </StrictMode>
);
