import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { CurrencyPicker } from "../components/CurrencyPicker.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "./lib/copy.js";
import { PreviewBoard, usePreviewTradeUps } from "./pages/PreviewBoard.js";
import { PreviewLanding } from "./pages/PreviewLanding.js";
import "./preview.css";

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

function PreviewChrome({ children, mode, onMode }: { children: ReactNode; mode: "light" | "dark"; onMode: () => void }) {
  return (
    <div data-preview data-system="outlay" data-mode={mode}>
      <title>TradeUpBot preview — kit landing</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="description" content="Internal TradeUpBot preview. Not for production navigation." />
      <header className="preview-nav">
        <Link to="/preview" className="preview-nav__brand">
          <img src="/favicon.svg" alt="" />
          TradeUpBot
        </Link>
        <nav className="preview-nav__links" aria-label="Preview">
          <a className="preview-btn preview-btn--ghost" href="#faq">FAQ</a>
          <Link className="preview-btn preview-btn--ghost" to="/preview/trade-ups">Contracts</Link>
          <a className="preview-btn preview-btn--ghost" href="/pricing">Pricing</a>
        </nav>
        <div className="preview-nav__actions">
          <button type="button" className="preview-btn" onClick={onMode}>
            {mode === "dark" ? "Light" : "Dark"}
          </button>
          <CurrencyPicker />
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
    />
  );
}

export default function PreviewApp() {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    document.getElementById("root")?.classList.remove("app-shell");
    fetch("/api/global-stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  return (
    <PreviewChrome mode={mode} onMode={() => setMode((m) => (m === "dark" ? "light" : "dark"))}>
      {/* Keep production copy identifiers in this module for isolation tests. */}
      <span className="sr-only">{PREVIEW_HEADLINE}</span>
      <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
      <Routes>
        <Route index element={<PreviewLanding stats={stats} />} />
        <Route path="trade-ups" element={<BoardRoute />} />
        <Route path="/preview" element={<PreviewLanding stats={stats} />} />
        <Route path="/preview/trade-ups" element={<BoardRoute />} />
        <Route path="*" element={<Navigate to="/preview" replace />} />
      </Routes>
    </PreviewChrome>
  );
}
