import { useState, lazy, Suspense } from "react";
import { Routes, Route, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { SyncStatus } from "../shared/types.js";
import { timeAgo } from "./utils/format.js";
import { useStatus, type StatusDiffs } from "./hooks/useStatus.js";
import { DaemonModal } from "./components/DaemonModal.js";
import { TradeUpsPage } from "./pages/TradeUpsPage.js";
const DataViewer = lazy(() => import("./components/DataViewer.js").then(m => ({ default: m.DataViewer })));
const CollectionViewer = lazy(() => import("./components/CollectionViewer.js").then(m => ({ default: m.CollectionViewer })));
const CollectionListViewer = lazy(() => import("./components/CollectionListViewer.js").then(m => ({ default: m.CollectionListViewer })));

function Diff({ value, label }: { value: number; label?: string }) {
  if (value === 0) return null;
  const color = value > 0 ? "#22c55e" : "#ef4444";
  return <span style={{ color, fontSize: "0.85em" }}> {value > 0 ? "+" : ""}{value.toLocaleString()}{label ? ` ${label}` : ""}</span>;
}

function StatusBar({ status, diffs, view }: { status: SyncStatus | null; diffs: StatusDiffs; view: string }) {
  if (view === "data") {
    return (
      <div className="status-bar">
        <div className="status-stats">
          <span className="status-item">
            Skins: <strong>{status?.total_skins?.toLocaleString() ?? "..."}</strong>
            <span className="status-sub"> ({status?.covert_skins ?? "?"} covert, {status?.knife_glove_with_listings ?? "?"}/{status?.knife_glove_skins ?? "?"} knives/gloves)</span>
          </span>
          <span className="status-item">
            Listings: <strong>{status?.total_listings?.toLocaleString() ?? "..."}</strong>
          </span>
          <span className="status-item">
            Sales: <strong>{status?.total_sales?.toLocaleString() ?? "..."}</strong>
          </span>
          <span className="status-item">
            Output Prices: <strong>{status?.covert_sale_prices ?? "..."}</strong> sale-based
            <span className="status-sub"> + {status?.covert_ref_prices ?? "?"} ref</span>
          </span>
        </div>
      </div>
    );
  }

  if (view === "collections") {
    return (
      <div className="status-bar">
        <div className="status-stats">
          <span className="status-item">
            Collections: <strong>{status?.collection_count ?? "..."}</strong>
            <span className="status-sub"> ({status?.collections_with_knives ?? "?"} with knife/glove pool)</span>
          </span>
          <span className="status-item">
            Trade-Ups: <strong>{status?.knife_trade_ups?.toLocaleString() ?? "..."}</strong>
            {status && status.knife_profitable > 0 && (
              <span className="status-highlight"> ({status.knife_profitable} profitable)</span>
            )}
          </span>
          <span className="status-item">
            Output Prices: <strong>{status?.covert_sale_prices ?? "..."}</strong> sale-based
          </span>
        </div>
      </div>
    );
  }

  if (view === "collection") {
    return (
      <div className="status-bar">
        <div className="status-stats">
          <span className="status-item">
            Last Calc: <strong>{timeAgo(status?.last_calculation ?? null)}</strong>
          </span>
        </div>
      </div>
    );
  }

  if (view === "theories") {
    return (
      <div className="status-bar">
        <div className="status-stats">
          <span className="status-item">
            Theories: <strong>{status?.theory_trade_ups?.toLocaleString() ?? "..."}</strong>
            <Diff value={diffs.theory_trade_ups} />
            {status && status.theory_profitable > 0 && (
              <span className="status-highlight"> ({status.theory_profitable.toLocaleString()} profitable<Diff value={diffs.theory_profitable} />)</span>
            )}
          </span>
          {status?.theory_tracking && (
            <>
              <span className="status-item">
                Validated: <strong>{status.theory_tracking.profitable}</strong> real
                <span className="status-sub"> / {status.theory_tracking.near_miss} near-miss / {status.theory_tracking.invalidated} invalid</span>
              </span>
              <span className="status-item">
                Cooldown: <strong>{status.theory_tracking.on_cooldown}</strong> combos
                {status.theory_tracking.avg_gap_cents > 0 && (
                  <span className="status-sub"> (avg gap ${(status.theory_tracking.avg_gap_cents / 100).toFixed(0)})</span>
                )}
              </span>
            </>
          )}
          <span className="status-item">
            Output Prices: <strong>{status?.covert_sale_prices ?? "..."}</strong> sale-based
            {status && status.total_sales > 0 && (
              <span className="status-sub"> ({status.total_sales.toLocaleString()} sales)</span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Default: trade-ups (knife + classified + staircase)
  return (
    <div className="status-bar">
      <div className="status-stats">
        <span className="status-item">
          Knife/Glove: <strong>{status?.knife_trade_ups?.toLocaleString() ?? "..."}</strong>
          <Diff value={diffs.knife_trade_ups} />
          {status && status.knife_profitable > 0 && (
            <span className="status-highlight"> ({status.knife_profitable.toLocaleString()} profitable<Diff value={diffs.knife_profitable} />)</span>
          )}
        </span>
        <span className="status-item">
          Classified: <strong>{status?.covert_trade_ups?.toLocaleString() ?? "..."}</strong>
          <Diff value={diffs.covert_trade_ups} />
          {status && status.covert_profitable > 0 && (
            <span className="status-highlight"> ({status.covert_profitable} profitable<Diff value={diffs.covert_profitable} />)</span>
          )}
        </span>
        {status && (status.knife_partial > 0 || status.knife_stale > 0) && (
          <span className="status-item">
            <span style={{ color: "#22c55e" }}>{status.knife_active.toLocaleString()} active</span>
            {status.knife_partial > 0 && <span style={{ color: "#f59e0b" }}> / {status.knife_partial.toLocaleString()} partial</span>}
            {status.knife_stale > 0 && <span style={{ color: "#ef4444" }}> / {status.knife_stale.toLocaleString()} stale</span>}
          </span>
        )}
        <span className="status-item">
          Inputs: <strong>{status?.covert_listings?.toLocaleString() ?? "..."}</strong> covert
          <span className="status-sub"> + {status?.classified_listings ?? "?"} classified</span>
        </span>
        <span className="status-item">
          Last Calc: <strong>{timeAgo(status?.last_calculation ?? null)}</strong>
        </span>
        {status?.exploration_stats && (
          <span className="status-item">
            Passes: <strong>{status.exploration_stats.passes_this_cycle}</strong>
            <span className="status-sub"> (+{status.exploration_stats.new_tradeups_found} new, {status.exploration_stats.tradeups_improved} improved)</span>
          </span>
        )}
      </div>
    </div>
  );
}

const TRADE_UP_TYPES = [
  { value: "covert_knife" as const, label: "Knife/Gloves" },
  { value: "classified_covert" as const, label: "Classified" },
  { value: "classified_covert_st" as const, label: "StatTrak" },
  { value: "staircase" as const, label: "Staircases" },
];

const THEORY_TYPES = [
  { value: "theory_knife" as const, label: "Knife/Gloves" },
  { value: "theory_classified" as const, label: "Classified" },
  { value: "theory_staircase" as const, label: "Staircases" },
];

function CollectionPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  if (!name) return null;

  return (
    <>
      <StatusBar status={status} diffs={diffs} view="collection" />
      <Suspense fallback={<div className="loading">Loading</div>}>
        <CollectionViewer
          collectionName={decodeURIComponent(name)}
          onBack={() => navigate("/collections")}
          onNavigateCollection={(n) => navigate(`/collections/${encodeURIComponent(n)}`)}
        />
      </Suspense>
    </>
  );
}

function CollectionListPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const navigate = useNavigate();
  return (
    <>
      <StatusBar status={status} diffs={diffs} view="collections" />
      <Suspense fallback={<div className="loading">Loading</div>}>
        <CollectionListViewer
          onSelectCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
        />
      </Suspense>
    </>
  );
}

function DataPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || undefined;

  return (
    <>
      <StatusBar status={status} diffs={diffs} view="data" />
      <Suspense fallback={<div className="loading">Loading</div>}>
        <DataViewer
          key={initialSearch || "data"}
          onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
          initialSearch={initialSearch}
        />
      </Suspense>
    </>
  );
}

function TradeUpsMainPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const navigate = useNavigate();
  return (
    <>
      <StatusBar status={status} diffs={diffs} view="tradeups" />
      <TradeUpsPage
        types={TRADE_UP_TYPES}
        defaultType="covert_knife"
        status={status}
        onNavigateSkin={(name) => navigate(`/data?search=${encodeURIComponent(name)}`)}
        onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
      />
    </>
  );
}

function TheoriesMainPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const navigate = useNavigate();
  return (
    <>
      <StatusBar status={status} diffs={diffs} view="theories" />
      <TradeUpsPage
        types={THEORY_TYPES}
        defaultType="theory_knife"
        status={status}
        onNavigateSkin={(name) => navigate(`/data?search=${encodeURIComponent(name)}`)}
        onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
      />
    </>
  );
}

export default function App() {
  const { status, diffs, newDataHint, refresh } = useStatus();
  const [showDaemonModal, setShowDaemonModal] = useState(false);

  return (
    <>
      <div className="header">
        <h1>CS2 Trade-Up Bot</h1>
        <div className="header-actions">
          <button
            className={`refresh-btn${newDataHint ? " refresh-hint" : ""}`}
            onClick={refresh}
          >
            {newDataHint ? "Refresh (new data)" : "Refresh"}
            {newDataHint && <span className="refresh-dot" />}
          </button>
          <button
            className={`daemon-btn${!status?.daemon_status || status.daemon_status.phase === "idle" ? " daemon-inactive" : " daemon-active"}`}
            onClick={() => setShowDaemonModal(true)}
          >
            {!status?.daemon_status || status.daemon_status.phase === "idle" ? "Daemon (inactive)" : (() => {
              const ds = status?.daemon_status;
              const cycle = ds?.cycle ?? 0;
              let uptime = "";
              if (ds?.startedAt) {
                const mins = Math.floor((Date.now() - new Date(ds.startedAt).getTime()) / 60000);
                uptime = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}m` : ""}`;
              }
              return `Daemon C${cycle}${uptime ? ` ${uptime}` : ""}`;
            })()}
          </button>
        </div>
      </div>

      {showDaemonModal && <DaemonModal onClose={() => setShowDaemonModal(false)} />}

      {/* Navigation */}
      <nav className="type-toggle">
        <NavLink to="/" end className={({ isActive }) => isActive ? "toggle-active" : ""}>
          Trade-Ups
        </NavLink>
        <NavLink to="/theories" className={({ isActive }) => isActive ? "toggle-active" : ""}>
          Theories
        </NavLink>
        <NavLink to="/data" className={({ isActive }) => isActive ? "toggle-active" : ""}>
          Data
        </NavLink>
        <NavLink to="/collections" className={({ isActive }) => isActive ? "toggle-active" : ""}>
          Collections
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<TradeUpsMainPage status={status} diffs={diffs} />} />
        <Route path="/theories" element={<TheoriesMainPage status={status} diffs={diffs} />} />
        <Route path="/data" element={<DataPage status={status} diffs={diffs} />} />
        <Route path="/collections" element={<CollectionListPage status={status} diffs={diffs} />} />
        <Route path="/collections/:name" element={<CollectionPage status={status} diffs={diffs} />} />
      </Routes>
    </>
  );
}
