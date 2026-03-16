import { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { SyncStatus } from "../shared/types.js";
import { timeAgo } from "./utils/format.js";
import { useStatus, type StatusDiffs } from "./hooks/useStatus.js";
import { DaemonModal } from "./components/DaemonModal.js";
import { TradeUpsPage } from "./pages/TradeUpsPage.js";
import { LandingPage } from "./pages/LandingPage.js";
import { Button } from "../shared/components/ui/button.js";
const DataViewer = lazy(() => import("./components/DataViewer.js").then(m => ({ default: m.DataViewer })));
const CollectionViewer = lazy(() => import("./components/CollectionViewer.js").then(m => ({ default: m.CollectionViewer })));
const CollectionListViewer = lazy(() => import("./components/CollectionListViewer.js").then(m => ({ default: m.CollectionListViewer })));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage.js").then(m => ({ default: m.CalculatorPage })));

function Diff({ value, label }: { value: number; label?: string }) {
  if (value === 0) return null;
  return (
    <span className={`text-[0.85em] ${value > 0 ? "text-green-500" : "text-red-500"}`}>
      {" "}{value > 0 ? "+" : ""}{value.toLocaleString()}{label ? ` ${label}` : ""}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-sm text-muted-foreground">
      {label}: <strong className="text-foreground">{children}</strong>
    </span>
  );
}

function StatusBar({ status, diffs, view }: { status: SyncStatus | null; diffs: StatusDiffs; view: string }) {
  const bar = (children: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 px-3 mb-3 rounded-lg bg-muted/60 border border-border/50 text-sm">
      {children}
    </div>
  );

  if (view === "data") {
    return bar(<>
      <Stat label="Skins">{status?.total_skins?.toLocaleString() ?? "..."}
        <span className="text-muted-foreground font-normal"> ({status?.covert_skins ?? "?"} covert, {status?.knife_glove_with_listings ?? "?"}/{status?.knife_glove_skins ?? "?"} knives/gloves)</span>
      </Stat>
      <Stat label="Listings">{status?.total_listings?.toLocaleString() ?? "..."}</Stat>
      <Stat label="Sales">{status?.total_sales?.toLocaleString() ?? "..."}</Stat>
      <Stat label="Output Prices">{status?.covert_sale_prices ?? "..."} sale-based
        <span className="text-muted-foreground font-normal"> + {status?.covert_ref_prices ?? "?"} ref</span>
      </Stat>
    </>);
  }

  if (view === "collections") {
    return bar(<>
      <Stat label="Collections">{status?.collection_count ?? "..."}
        <span className="text-muted-foreground font-normal"> ({status?.collections_with_knives ?? "?"} with knife/glove pool)</span>
      </Stat>
      <Stat label="Trade-Ups">{status?.knife_trade_ups?.toLocaleString() ?? "..."}
        {status && status.knife_profitable > 0 && <span className="text-green-500"> ({status.knife_profitable} profitable)</span>}
      </Stat>
      <Stat label="Output Prices">{status?.covert_sale_prices ?? "..."} sale-based</Stat>
    </>);
  }

  if (view === "collection") {
    return bar(<Stat label="Last Calc">{timeAgo(status?.last_calculation ?? null)}</Stat>);
  }

  // Default: trade-ups — show key stats
  return bar(<>
    <Stat label="Listings">{status?.total_listings?.toLocaleString() ?? "..."}</Stat>
    <Stat label="Sales">{status?.total_sales?.toLocaleString() ?? "..."}</Stat>
    <Stat label="Price Cache">{status?.covert_sale_prices ?? "?"} sale + {status?.covert_ref_prices ?? "?"} ref</Stat>
    <Stat label="Last Calc">{timeAgo(status?.last_calculation ?? null)}</Stat>
    {status?.daemon_status && (
      <Stat label="Daemon">{status.daemon_status.phase}
        {(status.daemon_status?.cycle ?? 0) > 0 && <span className="text-muted-foreground font-normal"> C{status.daemon_status?.cycle}</span>}
      </Stat>
    )}
  </>);
}

const TRADE_UP_TYPES = [
  { value: "all" as const, label: "All" },
  { value: "covert_knife" as const, label: "Knife/Gloves" },
  { value: "classified_covert" as const, label: "Classified" },
  { value: "restricted_classified" as const, label: "Restricted" },
  { value: "milspec_restricted" as const, label: "Mil-Spec" },
  { value: "industrial_milspec" as const, label: "Industrial" },
  { value: "staircase" as const, label: "Staircases" },
];


function CollectionPage({ status, diffs }: { status: SyncStatus | null; diffs: StatusDiffs }) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  if (!name) return null;

  return (
    <>
      <StatusBar status={status} diffs={diffs} view="collection" />
      <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
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
      <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
        <CollectionListViewer
          onSelectCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
        />
      </Suspense>
    </>
  );
}

function DataPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || undefined;

  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
      <DataViewer
        key={initialSearch || "data"}
        onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
        initialSearch={initialSearch}
      />
    </Suspense>
  );
}

function TradeUpsMainPage({ status, refreshKey }: { status: SyncStatus | null; refreshKey?: number }) {
  const navigate = useNavigate();
  return (
    <TradeUpsPage
      types={TRADE_UP_TYPES}
      defaultType="covert_knife"
      status={status}
      refreshKey={refreshKey}
      onNavigateSkin={(name) => navigate(`/data?search=${encodeURIComponent(name)}`)}
      onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
    />
  );
}


function AppShell() {
  const { status, diffs, newDataHint, refresh } = useStatus();
  const [showDaemonModal, setShowDaemonModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground">CS2 Trade-Up Bot</h1>
        <div className="flex gap-2">
          <Button
            variant={newDataHint ? "default" : "outline"}
            size="sm"
            onClick={() => { refresh(); setRefreshKey(k => k + 1); }}
          >
            {newDataHint ? "Refresh (new data)" : "Refresh"}
            {newDataHint && <span className="ml-1 inline-block size-2 rounded-full bg-green-400 animate-pulse" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDaemonModal(true)}
            className={!status?.daemon_status || status.daemon_status.phase === "idle"
              ? "border-muted-foreground/30 text-muted-foreground"
              : "border-green-500/50 text-green-400"}
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
          </Button>
        </div>
      </div>

      {showDaemonModal && <DaemonModal onClose={() => setShowDaemonModal(false)} />}

      {/* Navigation */}
      <nav className="flex gap-1 mb-4 p-1 rounded-lg bg-muted/50 w-fit">
        {[
          { to: "/", label: "Trade-Ups", end: true },
          { to: "/data", label: "Data" },
          { to: "/collections", label: "Collections" },
          { to: "/calculator", label: "Calculator" },
        ].map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/" element={<TradeUpsMainPage status={status} refreshKey={refreshKey} />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/collections" element={<CollectionListPage status={status} diffs={diffs} />} />
        <Route path="/collections/:name" element={<CollectionPage status={status} diffs={diffs} />} />
        <Route path="/calculator" element={
          <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
            <CalculatorPage />
          </Suspense>
        } />
      </Routes>
    </>
  );
}

interface AuthUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => setUser(data))
      .catch(() => setUser(null));
  }, []);

  // Loading
  if (user === undefined) {
    return <div className="flex items-center justify-center h-screen bg-background text-muted-foreground animate-pulse">Loading...</div>;
  }

  // Not logged in: show landing page unless on /demo
  if (!user && !window.location.pathname.startsWith("/demo")) {
    return <LandingPage />;
  }

  // Logged in: show app
  return <AppShell />;
}
