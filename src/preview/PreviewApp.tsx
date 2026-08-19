import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PreviewCurrency } from "./components/PreviewCurrency.js";
import { PreviewMark } from "./components/PreviewMark.js";
import { pageFor, type ConsolePage } from "./lib/console-routes.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "./lib/copy.js";
import { buildHomepageJsonLd } from "../../shared/crawler-jsonld.js";
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
      <title>TradeUpBot — CS2 trade-ups from real listings</title>
      <meta name="description" content="CS2 trade-ups built from listings you can buy right now on CSFloat, DMarket, Skinport, and Buff.market." />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://tradeupbot.app/" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildHomepageJsonLd()) }} />
      <header className="preview-nav">
        <Link to="/" className="preview-brand">
          <PreviewMark size={20} />
          TradeUpBot
        </Link>
        <nav className="preview-nav__links" aria-label="Preview">
          <Link className="preview-btn preview-btn--quiet" to="/trade-ups">Board</Link>
          <Link className="preview-btn preview-btn--quiet" to="/skins">Skins</Link>
          <Link className="preview-btn preview-btn--quiet" to="/collections">Collections</Link>
          <a className="preview-btn preview-btn--quiet" href="#faq">FAQ</a>
        </nav>
        <div className="preview-bar__actions">
          <button type="button" className="preview-btn" onClick={onMode}>
            {mode === "dark" ? "Light" : "Dark"}
          </button>
          <PreviewCurrency />
          <Link className="preview-btn preview-btn--lime" to="/trade-ups">Open the console</Link>
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
      throttle={state.throttle}
    />
  );
}

export default function PreviewApp(props: { page?: ConsolePage } = {}) {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const location = useLocation();

  useEffect(() => {
    document.getElementById("root")?.classList.remove("app-shell");
    fetch("/api/global-stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const onMode = () => setMode((m) => (m === "dark" ? "light" : "dark"));
  const page = pageFor(props.page, location.pathname);
  const view = (() => {
    switch (page) {
      case "board": return <BoardRoute />;
      case "skins": return <PreviewSkinsPage />;
      case "skin": return <PreviewSkinPage />;
      case "collections": return <PreviewCollectionsPage />;
      case "collection": return <PreviewCollectionPage />;
      case "calculator": return <PreviewCalculator />;
      case "account": return <PreviewAccount />;
      case "landing":
      default: return <PreviewLanding stats={stats} mode={mode} />;
    }
  })();

  if (page !== "landing") {
    return (
      <PreviewShell mode={mode} onMode={onMode}>
        <span className="sr-only">{PREVIEW_HEADLINE}</span>
        <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
        {view}
      </PreviewShell>
    );
  }

  return (
    <PreviewChrome mode={mode} onMode={onMode}>
      <span className="sr-only">{PREVIEW_HEADLINE}</span>
      <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
      {view}
    </PreviewChrome>
  );
}
