import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { isMarketingPage, pageFor, type ConsolePage } from "./lib/console-routes.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "./lib/copy.js";
import { PreviewAccount } from "./pages/PreviewAccount.js";
import { PreviewBlogIndex, PreviewBlogPost } from "./pages/PreviewBlog.js";
import { PreviewBoard, usePreviewTradeUps } from "./pages/PreviewBoard.js";
import { PreviewCalculator } from "./pages/PreviewCalculator.js";
import { PreviewCollectionTradeUps } from "./pages/PreviewCollectionTradeUps.js";
import { PreviewFaq } from "./pages/PreviewFaq.js";
import { PreviewFeatures } from "./pages/PreviewFeatures.js";
import { PreviewLanding } from "./pages/PreviewLanding.js";
import { PreviewPrivacy, PreviewTerms } from "./pages/PreviewLegal.js";
import { PreviewPricing } from "./pages/PreviewPricing.js";
import { PreviewShare } from "./pages/PreviewShare.js";
import {
  PreviewCollectionPage,
  PreviewCollectionsPage,
  PreviewSkinPage,
  PreviewSkinsPage,
} from "./pages/PreviewSkins.js";
import { PreviewSniper } from "./pages/PreviewSniper.js";
import { PreviewChrome } from "./PreviewChrome.js";
import { PreviewShell } from "./PreviewShell.js";
import "./preview.css";

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
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
      case "pricing": return <PreviewPricing />;
      case "faq": return <PreviewFaq />;
      case "features": return <PreviewFeatures />;
      case "blog": return <PreviewBlogIndex />;
      case "post": return <PreviewBlogPost />;
      case "terms": return <PreviewTerms />;
      case "privacy": return <PreviewPrivacy />;
      case "share": return <PreviewShare />;
      case "sniper": return <PreviewSniper />;
      case "collectionTradeUps": return <PreviewCollectionTradeUps />;
      case "landing":
      default: return <PreviewLanding stats={stats} mode={mode} />;
    }
  })();

  const chrome = (
    <>
      <span className="sr-only">{PREVIEW_HEADLINE}</span>
      <span className="sr-only">{PREVIEW_FAQ[0]?.q}</span>
      {view}
    </>
  );

  if (isMarketingPage(page)) {
    return (
      <PreviewChrome mode={mode} onMode={onMode} home={page === "landing"}>
        {chrome}
      </PreviewChrome>
    );
  }

  return (
    <PreviewShell mode={mode} onMode={onMode}>
      {chrome}
    </PreviewShell>
  );
}
