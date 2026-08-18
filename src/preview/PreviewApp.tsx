import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { PreviewLandingPage } from "./pages/PreviewLandingPage.js";
import { PreviewTradeUpsPage } from "./pages/PreviewTradeUpsPage.js";
import { PreviewCalculatorPage } from "./pages/PreviewCalculatorPage.js";
import { PreviewAccountPage } from "./pages/PreviewAccountPage.js";
import { PreviewShell } from "./chrome/PreviewShell.js";
import "./preview.css";

export function PreviewApp() {
  useEffect(() => {
    document.documentElement.classList.add("pv-html");
    document.body.classList.add("pv-body");
    document.getElementById("root")?.classList.remove("app-shell");
    return () => {
      document.documentElement.classList.remove("pv-html");
      document.body.classList.remove("pv-body");
    };
  }, []);

  return (
    <div className="pv-app" data-preview-app>
      <title>Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <div className="pv-grain" />
      <div className="pv-grid" />
      <div className="pv-scan" />
      <Routes>
        <Route path="/" element={<PreviewLandingPage />} />
        <Route element={<PreviewShell />}>
          <Route path="trade-ups" element={<PreviewTradeUpsPage />} />
          <Route path="calculator" element={<PreviewCalculatorPage />} />
          <Route path="account" element={<PreviewAccountPage />} />
        </Route>
      </Routes>
    </div>
  );
}
