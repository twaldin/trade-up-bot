import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { PreviewCurrency } from "./components/PreviewCurrency.js";
import { PreviewMark } from "./components/PreviewMark.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "./lib/copy.js";
import { PreviewAccount } from "./pages/PreviewAccount.js";
import { PreviewBoard, usePreviewTradeUps } from "./pages/PreviewBoard.js";
import { PreviewCalculator } from "./pages/PreviewCalculator.js";
import { PreviewLanding } from "./pages/PreviewLanding.js";
import {
  PreviewCollectionPage,
  PreviewCollectionsPage,
  PreviewSkinPage,
  PreviewSkinsPage,
} from "./pages/PreviewSkins.js";
import { PreviewShell } from "./PreviewShell.js";
import "./preview.css";

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

function PreviewChrome({ children, mode, onMode }: { children: ReactNode; mode: "light" | "dark"; onMode: () => void }) {
  return (
    <div data-preview data-system="outlay" data-mode={mode} data-view="landing">
      <title>TradeUpBot preview — kit landing</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="description" content="Internal TradeUpBot preview. Not for production navigation." />
      <header className="preview-nav">
        <Link to="/preview" className="preview-brand">
          <PreviewMark size={20} />
          TradeUpBot
        </Link>
        <nav className="preview-nav__links" aria-label="Preview">
          <Link className="preview-btn preview-btn--quiet" to="/preview/trade-ups">Board</Link>
          <Link className="preview-btn preview-btn--quiet" to="/preview/skins">Skins</Link>
          <Link className="preview-btn preview-btn--quiet" to="/preview/collections">Collections</Link>
          <a className="preview-btn preview-btn--quiet" href="#faq">FAQ</a>
        </nav>
        <div className="preview-bar__actions">
          <button type="button" className="preview-btn" onClick={onMode}>
            {mode === "dark" ? "Light" : "Dark"}
          </button>
          <PreviewCurrency />
          <Link className="preview-btn preview-btn--lime" to="/preview/trade-ups">Open the console</Link>
        </div>
      </header>
      {children}
    </div>
  );
}

function BoardRoute() {
  const state = usePreviewTradeUps();
  return (
    <PreviewBoard
      tradeUps={state.tradeUps}
      loading={state.loading}
      isFree={state.isFree}
      expandedId={state.expandedId}
      onExpand={state.onExpand}
      query={state.query}
      onQuery={state.onQuery}
      search={state.search}
      onSearch={state.onSearch}
      onParsed={state.onParsed}
      loadMore={state.loadMore}
      exhausted={state.exhausted}
    />
  );
}

export default function PreviewApp() {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const location = useLocation();
  const inConsole = /\/preview\/(trade-ups|calculator|account|skins|collections)/.test(location.pathname);

  useEffect(() => {
    document.getElementById("root")?.classList.remove("app-shell");
    fetch("/api/global-stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const onMode = () => setMode((m) => (m === "dark" ? "light" : "dark"));
  const routes = (
    <Routes>
      <Route index element={<PreviewLanding stats={stats} mode={mode} />} />
      <Route path="trade-ups" element={<BoardRoute />} />
      <Route path="skins" element={<PreviewSkinsPage />} />
      <Route path="skins/:slug" element={<PreviewSkinPage />} />
      <Route path="collections" element={<PreviewCollectionsPage />} />
      <Route path="collections/:name" element={<PreviewCollectionPage />} />
      <Route path="calculator" element={<PreviewCalculator />} />
      <Route path="account" element={<PreviewAccount />} />
      <Route path="/preview" element={<PreviewLanding stats={stats} mode={mode} />} />
      <Route path="/preview/trade-ups" element={<BoardRoute />} />
      <Route path="/preview/skins" element={<PreviewSkinsPage />} />
      <Route path="/preview/skins/:slug" element={<PreviewSkinPage />} />
      <Route path="/preview/collections" element={<PreviewCollectionsPage />} />
      <Route path="/preview/collections/:name" element={<PreviewCollectionPage />} />
      <Route path="/preview/calculator" element={<PreviewCalculator />} />
      <Route path="/preview/account" element={<PreviewAccount />} />
      <Route path="*" element={<Navigate to="/preview" replace />} />
    </Routes>
  );

  if (inConsole) {
    return (
      <PreviewShell mode={mode} onMode={onMode}>
        <span className="sr-only">{PREVIEW_HEADLINE}</span>
        <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
        {routes}
      </PreviewShell>
    );
  }

  return (
    <PreviewChrome mode={mode} onMode={onMode}>
      <span className="sr-only">{PREVIEW_HEADLINE}</span>
      <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
      {routes}
    </PreviewChrome>
  );
}
