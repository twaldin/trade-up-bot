import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.js";
import { CurrencyProvider } from "./contexts/CurrencyContext.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <CurrencyProvider>
          <App />
        </CurrencyProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>
);
