import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { PreviewLandingPage } from "./pages/PreviewLandingPage.js";
import { PreviewTradeUpsPage } from "./pages/PreviewTradeUpsPage.js";
import { PreviewCalculatorPage } from "./pages/PreviewCalculatorPage.js";
import { PreviewAccountPage } from "./pages/PreviewAccountPage.js";
import {
  PreviewCollectionPage,
  PreviewCollectionsPage,
  PreviewListingSniperPage,
  PreviewMyTradeUpsPage,
  PreviewSkinDetailPage,
  PreviewSkinsPage,
} from "./pages/PreviewCatalogPages.js";
import { PreviewShell } from "./chrome/PreviewShell.js";
import { PreviewThemeProvider, usePreviewTheme } from "./theme/PreviewTheme.js";
import "./preview.css";

function PreviewRoutes() {
  const { theme } = usePreviewTheme();
  return (
    <div className="pv-app" data-preview-app data-theme={theme}>
      <title>Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <Routes>
        <Route path="/" element={<PreviewLandingPage />} />
        <Route element={<PreviewShell />}>
          <Route path="trade-ups" element={<PreviewTradeUpsPage />} />
          <Route path="calculator" element={<PreviewCalculatorPage />} />
          <Route path="account" element={<PreviewAccountPage />} />
          <Route path="my-trade-ups" element={<PreviewMyTradeUpsPage />} />
          <Route path="skins/:slug" element={<PreviewSkinDetailPage />} />
          <Route path="skins" element={<PreviewSkinsPage />} />
          <Route path="collections" element={<PreviewCollectionsPage />} />
          <Route path="collections/:name" element={<PreviewCollectionPage />} />
          <Route path="listing-sniper" element={<PreviewListingSniperPage />} />
        </Route>
      </Routes>
    </div>
  );
}

export function PreviewApp() {
  useEffect(() => {
    document.getElementById("root")?.classList.remove("app-shell");
  }, []);

  return (
    <PreviewThemeProvider>
      <PreviewRoutes />
    </PreviewThemeProvider>
  );
}
