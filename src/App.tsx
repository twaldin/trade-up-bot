import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { CurrencyPicker } from "./components/CurrencyPicker.js";
import { Routes, Route, NavLink, useNavigate, useParams, useSearchParams, useLocation, Navigate } from "react-router-dom";
import type { SyncStatus } from "../shared/types.js";
import { collectionToSlug } from "../shared/slugs.js";
import { useStatus } from "./hooks/useStatus.js";
import { DaemonModal } from "./components/DaemonModal.js";
const TradeUpsPage = lazy(() => import("./pages/TradeUpsPage.js").then(m => ({ default: m.TradeUpsPage })));
const LandingPage = lazy(() => import("./pages/LandingPage.js").then(m => ({ default: m.LandingPage })));
const FaqPage = lazy(() => import("./pages/FaqPage.js").then(m => ({ default: m.FaqPage })));
const TermsPage = lazy(() => import("./pages/TermsPage.js").then(m => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage.js").then(m => ({ default: m.PrivacyPage })));
const FeaturesPage = lazy(() => import("./pages/FeaturesPage.js").then(m => ({ default: m.FeaturesPage })));
const PricingPage = lazy(() => import("./pages/PricingPage.js").then(m => ({ default: m.PricingPage })));
const MyTradeUpsPage = lazy(() => import("./pages/MyTradeUpsPage.js"));
const ListingSniperPage = lazy(() => import("./pages/ListingSniperPage.js").then(m => ({ default: m.ListingSniperPage })));
const BlogPage = lazy(() => import("./pages/BlogPage.js").then(m => ({ default: m.BlogPage })));
const BlogPostPage = lazy(() => import("./pages/BlogPostPage.js").then(m => ({ default: m.BlogPostPage })));
import { SiteFooter } from "./components/SiteFooter.js";
import { Button } from "../shared/components/ui/button.js";
import { TRADE_UP_TYPE_TABS } from "./utils/rarity.js";
const DataViewer = lazy(() => import("./components/DataViewer.js").then(m => ({ default: m.DataViewer })));
const CollectionViewer = lazy(() => import("./components/CollectionViewer.js").then(m => ({ default: m.CollectionViewer })));
const CollectionListViewer = lazy(() => import("./components/CollectionListViewer.js").then(m => ({ default: m.CollectionListViewer })));
const CalculatorPage = lazy(() => import("./pages/CalculatorPage.js").then(m => ({ default: m.CalculatorPage })));
const TradeUpSharePage = lazy(() => import("./pages/TradeUpSharePage.js").then(m => ({ default: m.TradeUpSharePage })));
const SkinPage = lazy(() => import("./pages/SkinPage.js").then(m => ({ default: m.SkinPage })));

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  total_cycles: number;
}

function GlobalStatBar({ stats }: { stats: GlobalStats | null }) {
  if (!stats || stats.total_trade_ups == null) return null;

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

const TRADE_UP_TYPES = TRADE_UP_TYPE_TABS;


function CollectionPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [collectionName, setCollectionName] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    fetch(`/api/collection-by-slug/${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.name) {
          setCollectionName(data.name);
        } else {
          setCollectionName(decodeURIComponent(name));
        }
      })
      .catch(() => setCollectionName(decodeURIComponent(name)));
  }, [name]);

  if (!collectionName) {
    return <div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>;
  }

  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
      <CollectionViewer
        collectionName={collectionName}
        onBack={() => navigate("/collections")}
        onNavigateCollection={(n) => navigate(`/collections/${collectionToSlug(n)}`)}
      />
    </Suspense>
  );
}

function CollectionListPage() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
      <CollectionListViewer
        onSelectCollection={(name) => navigate(`/collections/${collectionToSlug(name)}`)}
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
        onNavigateCollection={(name) => navigate(`/collections/${collectionToSlug(name)}`)}
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
      onNavigateSkin={(name) => navigate(`/skins?search=${encodeURIComponent(name)}`)}
      onNavigateCollection={(name) => navigate(`/collections/${collectionToSlug(name)}`)}
    />
  );
}


function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);

  const tierColors: Record<string, string> = {
    pro: "text-yellow-400",
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
          {user.tier === "pro" && !user.is_admin && (
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
              {(["free", "pro"] as const).map(t => (
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

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 gap-4">
      <div className="text-5xl font-bold text-muted-foreground/40 tabular-nums">404</div>
      <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        The page you're looking for doesn't exist or has moved.
      </p>
      <a
        href="/trade-ups"
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
      >
        Go to Trade-Ups
      </a>
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
          <CurrencyPicker />
          {user ? (
            <UserMenu user={user} />
          ) : (
            <a
              href={`/auth/steam?return=${encodeURIComponent(window.location.pathname)}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/></svg>
              Sign In
            </a>
          )}
        </div>
      </div>

      {userIsAdmin && showDaemonModal && <DaemonModal onClose={() => setShowDaemonModal(false)} />}

      {/* Navigation */}
      <nav className="flex gap-4 md:gap-6 mb-4 border-b border-border overflow-x-auto">
        {[
          { to: "/trade-ups", label: "Trade-Ups", end: true },
          ...(user && (user.tier === "pro" || user.is_admin) ? [{ to: "/my-trade-ups", label: "My Trade-Ups" }] : []),
          { to: "/skins", label: "Skins" },
          { to: "/collections", label: "Collections" },
          { to: "/calculator", label: "Calculator" },
          { to: "/listing-sniper", label: "Listing Sniper" },
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
        <Route path="/trade-ups" element={<TradeUpsMainPage status={status} refreshKey={refreshKey} />} />
        <Route path="/skins/:slug" element={
          <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
            <SkinPage />
          </Suspense>
        } />
        <Route path="/skins" element={<DataPage />} />
        <Route path="/collections" element={<CollectionListPage />} />
        <Route path="/collections/:name" element={<CollectionPage />} />
        <Route path="/calculator" element={
          <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
            <CalculatorPage />
          </Suspense>
        } />
        <Route path="/my-trade-ups" element={<MyTradeUpsPage />} />
        <Route path="/listing-sniper" element={<ListingSniperPage />} />
        {/* Legacy redirects */}
        <Route path="/dashboard" element={<Navigate to="/trade-ups" replace />} />
        <Route path="/data" element={<Navigate to="/skins" replace />} />
        <Route path="*" element={<NotFoundPage />} />
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
  const [user, setUser] = useState<AuthUser | null | undefined>(() => {
    try {
      const cached = localStorage.getItem("site_nav_user");
      if (cached) return JSON.parse(cached) as AuthUser;
    } catch {}
    return undefined;
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

  // Landing page always accessible
  if (location.pathname === "/" || location.pathname === "") {
    return <LandingPage user={user ?? undefined} />;
  }

  // Auth-required routes: redirect to landing if not logged in
  if (location.pathname === "/my-trade-ups") {
    if (user === undefined) {
      return <div className="flex items-center justify-center h-screen bg-background text-muted-foreground animate-pulse">Loading...</div>;
    }
    if (!user) return <LandingPage />;
  }

  // All other app routes: render publicly. Pass user (may be null/undefined).
  return <AppShell user={user ?? null} />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>}>
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
    </Suspense>
  );
}
