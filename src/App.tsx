import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Routes, Route, NavLink, useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import type { SyncStatus } from "../shared/types.js";
import { useStatus } from "./hooks/useStatus.js";
import { DaemonModal } from "./components/DaemonModal.js";
import { TradeUpsPage } from "./pages/TradeUpsPage.js";
import { LandingPage } from "./pages/LandingPage.js";
import { FaqPage } from "./pages/FaqPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { FeaturesPage } from "./pages/FeaturesPage.js";
import { PricingPage } from "./pages/PricingPage.js";
import { BlogPage } from "./pages/BlogPage.js";
import { BlogPostPage } from "./pages/BlogPostPage.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { Button } from "../shared/components/ui/button.js";
const DataViewer = lazy(() => import("./components/DataViewer.js").then(m => ({ default: m.DataViewer })));
const CollectionViewer = lazy(() => import("./components/CollectionViewer.js").then(m => ({ default: m.CollectionViewer })));
const CollectionListViewer = lazy(() => import("./components/CollectionListViewer.js").then(m => ({ default: m.CollectionListViewer })));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage.js").then(m => ({ default: m.CalculatorPage })));
const TradeUpSharePage = lazy(() => import("./pages/TradeUpSharePage.js").then(m => ({ default: m.TradeUpSharePage })));

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

function GlobalStatBar({ stats }: { stats: GlobalStats | null }) {
  if (!stats) return null;

  // Total analysis time = cycles * 20min target
  const totalMinutes = stats.total_cycles * 20;
  const hours = Math.floor(totalMinutes / 60);
  const analysisTime = hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h`
    : `${hours}h`;

  return (
    <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
      <span>
        <strong className="text-foreground">{stats.total_trade_ups.toLocaleString()}</strong> trade-ups
        {stats.profitable_trade_ups > 0 && (
          <span className="text-green-500 ml-1">({stats.profitable_trade_ups.toLocaleString()} profitable)</span>
        )}
      </span>
      <span className="text-border">|</span>
      <span><strong className="text-foreground">{stats.total_data_points.toLocaleString()}</strong> data points</span>
      <span className="text-border">|</span>
      <span><strong className="text-foreground">{analysisTime}</strong> analyzed</span>
    </div>
  );
}

const TRADE_UP_TYPES = [
  { value: "all" as const, label: "All", color: "" },
  { value: "covert_knife" as const, label: "Knife/Gloves", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500" },
  { value: "classified_covert" as const, label: "Covert", color: "border-red-500/40 bg-red-500/10 text-red-500" },
  { value: "restricted_classified" as const, label: "Classified", color: "border-pink-500/40 bg-pink-500/10 text-pink-500" },
  { value: "milspec_restricted" as const, label: "Restricted", color: "border-purple-500/40 bg-purple-500/10 text-purple-500" },
  { value: "industrial_milspec" as const, label: "Mil-Spec", color: "border-blue-500/40 bg-blue-500/10 text-blue-500" },
  { value: "consumer_industrial" as const, label: "Industrial", color: "border-sky-400/40 bg-sky-400/10 text-sky-400" },
];


function CollectionPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  if (!name) return null;

  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
      <CollectionViewer
        collectionName={decodeURIComponent(name)}
        onBack={() => navigate("/collections")}
        onNavigateCollection={(n) => navigate(`/collections/${encodeURIComponent(n)}`)}
      />
    </Suspense>
  );
}

function CollectionListPage() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
      <CollectionListViewer
        onSelectCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
      />
    </Suspense>
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
      defaultType="all"
      status={status}
      refreshKey={refreshKey}
      onNavigateSkin={(name) => navigate(`/data?search=${encodeURIComponent(name)}`)}
      onNavigateCollection={(name) => navigate(`/collections/${encodeURIComponent(name)}`)}
    />
  );
}


function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);

  const tierColors: Record<string, string> = {
    pro: "text-yellow-400",
    basic: "text-blue-400",
    free: "text-muted-foreground",
  };

  const setTier = async (newTier: string) => {
    await fetch("/api/admin/set-tier", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ tier: newTier }),
    });
    window.location.reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-muted transition-colors cursor-pointer"
      >
        {user.avatar_url && <img src={user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
        <span className="text-foreground font-medium">{user.display_name}</span>
        <span className={tierColors[user.tier] || "text-muted-foreground"}>
          ({user.tier})
        </span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-xl z-50 py-1">
          <div className="px-3 py-2 border-b border-border">
            <div className="text-sm font-medium">{user.display_name}</div>
            <div className="text-xs text-muted-foreground">Steam ID: {user.steam_id}</div>
            <div className={`text-xs font-medium mt-1 ${tierColors[user.tier]}`}>
              {user.tier.charAt(0).toUpperCase() + user.tier.slice(1)} Plan
              {user.is_admin && <span className="text-red-400 ml-1">(admin)</span>}
            </div>
          </div>

          {/* Subscription actions */}
          {user.tier === "free" && !user.is_admin && (
            <a href="/pricing" className="block w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-muted cursor-pointer">
              View Plans
            </a>
          )}
          {(user.tier === "basic" || user.tier === "pro") && !user.is_admin && (
            <button className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted cursor-pointer" onClick={async () => {
              const res = await fetch("/api/billing-portal", { method: "POST", credentials: "include" });
              const data = await res.json();
              if (data.url) window.location.href = data.url; else alert(data.error || "Failed");
            }}>
              Manage Subscription
            </button>
          )}

          {/* Discord linking */}
          {!user.discord_id ? (
            <a href="/api/auth/discord" className="block w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-muted cursor-pointer">
              Link Discord
            </a>
          ) : (
            <div className="px-3 py-2 border-t border-border">
              <div className="text-xs text-muted-foreground">Discord: <span className="text-foreground">{user.discord_tag}</span></div>
              <button className="text-xs text-red-400 hover:text-red-300 mt-1 cursor-pointer" onClick={async () => {
                await fetch("/api/auth/discord", { method: "DELETE", credentials: "include" });
                window.location.reload();
              }}>
                Unlink
              </button>
            </div>
          )}

          {/* Admin: direct plan change buttons */}
          {user.is_admin && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider border-t border-border mt-1">
                Change Plan
              </div>
              {(["free", "basic", "pro"] as const).map(t => (
                <button
                  key={t}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted cursor-pointer ${user.tier === t ? "text-foreground font-medium" : "text-muted-foreground"}`}
                  onClick={() => setTier(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {user.tier === t && " (current)"}
                </button>
              ))}
            </>
          )}

          <div className="border-t border-border mt-1">
            <a href="/auth/logout" className="block px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer">
              Sign Out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function AppShell({ user }: { user?: AuthUser | null }) {
  const userIsAdmin = user?.is_admin === true;
  const { status, newDataHint: statusHint, refresh } = useStatus(userIsAdmin);
  const [showDaemonModal, setShowDaemonModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const prevTotalRef = useRef(0);
  const [globalNewData, setGlobalNewData] = useState(false);

  // Fetch global stats on mount and every 60s
  useEffect(() => {
    const fetchStats = () =>
      fetch("/api/global-stats", { credentials: "include" })
        .then(r => r.json())
        .then((data: GlobalStats) => {
          setGlobalStats(data);
          if (prevTotalRef.current > 0 && data.total_trade_ups !== prevTotalRef.current) {
            setGlobalNewData(true);
          }
          prevTotalRef.current = data.total_trade_ups;
        })
        .catch(() => {});
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => clearInterval(interval);
  }, []);

  const newDataHint = statusHint || globalNewData;

  // Prefetch data + collections pages on mount to warm Redis cache
  // Responses are discarded — when user navigates, the Redis cache serves instantly
  useEffect(() => {
    fetch("/api/collections").catch(() => {});
    fetch("/api/skin-data?rarity=all&limit=200").catch(() => {});
  }, []);

  // Apply app-shell constraint (landing page is full-width)
  useEffect(() => {
    document.getElementById("root")?.classList.add("app-shell");
    return () => { document.getElementById("root")?.classList.remove("app-shell"); };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <a href="/" className="flex items-center gap-2 text-lg md:text-xl font-bold text-foreground whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity">
          <img src="/favicon.svg" alt="" className="w-5 h-5 md:w-6 md:h-6" />
          CS2 Trade-Up Bot
        </a>
        <GlobalStatBar stats={globalStats} />
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant={newDataHint ? "default" : "outline"}
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={() => { refresh(); setGlobalNewData(false); setRefreshKey(k => k + 1); }}
          >
            <span className="hidden sm:inline">{newDataHint ? "Refresh" : "Refresh"}</span>
            <span className="sm:hidden">↻</span>
            {newDataHint && <span className="ml-1 inline-block size-2 rounded-full bg-green-400 animate-pulse" />}
          </Button>
          {userIsAdmin && <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs hidden sm:inline-flex"
            onClick={() => setShowDaemonModal(true)}
          >
            {!status?.daemon_status || status.daemon_status.phase === "idle" ? "Daemon" : (() => {
              const ds = status?.daemon_status;
              const cycle = ds?.cycle ?? 0;
              return `C${cycle}`;
            })()}
          </Button>}
          {user && <UserMenu user={user} />}
        </div>
      </div>

      {userIsAdmin && showDaemonModal && <DaemonModal onClose={() => setShowDaemonModal(false)} />}

      {/* Navigation */}
      <nav className="flex gap-4 md:gap-6 mb-4 border-b border-border overflow-x-auto">
        {[
          { to: "/dashboard", label: "Trade-Ups", end: true },
          { to: "/data", label: "Data" },
          { to: "/collections", label: "Collections" },
          { to: "/calculator", label: "Calculator" },
        ].map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-1 pb-2 text-xs md:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/dashboard" element={<TradeUpsMainPage status={status} refreshKey={refreshKey} />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/collections" element={<CollectionListPage />} />
        <Route path="/collections/:name" element={<CollectionPage />} />
        <Route path="/calculator" element={
          <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
            <CalculatorPage />
          </Suspense>
        } />
      </Routes>
      </div>
      <SiteFooter />
    </div>
  );
}

interface AuthUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
  is_admin: boolean;
  discord_id?: string | null;
  discord_tag?: string | null;
}

function AuthGatedApp() {
  // Initialize from localStorage to avoid blocking "Loading..." screen.
  // If cached user exists, show UI immediately. Background fetch refreshes.
  const [user, setUser] = useState<AuthUser | null | undefined>(() => {
    try {
      const cached = localStorage.getItem("site_nav_user");
      if (cached) return JSON.parse(cached) as AuthUser;
    } catch {}
    return undefined; // no cache = show loading briefly
  });
  const location = useLocation();

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.steam_id) {
          setUser(data);
          try { localStorage.setItem("site_nav_user", JSON.stringify(data)); } catch {}
        } else {
          setUser(null);
          try { localStorage.removeItem("site_nav_user"); } catch {}
        }
      })
      .catch(() => setUser(null));
  }, []);

  // Only show loading if no cached user (first visit ever)
  if (user === undefined) {
    return <div className="flex items-center justify-center h-screen bg-background text-muted-foreground animate-pulse">Loading...</div>;
  }

  // Landing page: always accessible (logged in or not)
  // Logged-in users who navigate to / see landing page with "Dashboard" button
  if (location.pathname === "/" || location.pathname === "") {
    if (!user) return <LandingPage />;
    return <LandingPage user={user} />;
  }

  // All other app routes require login
  if (!user) {
    return <LandingPage />;
  }

  return <AppShell user={user} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/blog/:slug" element={<BlogPostPage />} />
      <Route path="/trade-ups/:id" element={
        <Suspense fallback={<div className="flex items-center justify-center h-screen bg-background text-muted-foreground animate-pulse">Loading</div>}>
          <TradeUpSharePage />
        </Suspense>
      } />
      <Route path="*" element={<AuthGatedApp />} />
    </Routes>
  );
}
