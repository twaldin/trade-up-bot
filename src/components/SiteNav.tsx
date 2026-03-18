import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/blog", label: "Blog" },
];

// Match main app UserMenu colors exactly
const tierColors: Record<string, string> = {
  pro: "text-yellow-400",
  basic: "text-blue-400",
  free: "text-muted-foreground",
  admin: "text-red-400",
};

interface NavUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
  is_admin?: boolean;
}

const STORAGE_KEY = "site_nav_user";

function loadCachedUser(): NavUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function cacheUser(user: NavUser | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function SiteNav() {
  const location = useLocation();
  // Initialize from localStorage to prevent flicker on navigation
  const [user, setUser] = useState<NavUser | null>(loadCachedUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.steam_id) {
          setUser(data);
          cacheUser(data);
        } else {
          setUser(null);
          cacheUser(null);
        }
      })
      .catch(() => {});
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight hover:opacity-80 transition-opacity min-w-[200px]">
          <img src="/favicon.svg" alt="" className="w-5 h-5" />
          TradeUpBot
        </Link>
        <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={location.pathname.startsWith(to) ? "text-foreground transition-colors" : "hover:text-foreground transition-colors"}
            >
              {label}
            </Link>
          ))}
        </div>
        {/* Fixed-width right section prevents center nav from shifting */}
        <div className="flex items-center gap-3 min-w-[200px] justify-end">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              >
                Dashboard
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  {user.avatar_url && <img src={user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
                  <span className="hidden md:inline">{user.display_name}</span>
                  <span className={`hidden md:inline ${tierColors[user.tier] || "text-muted-foreground"}`}>
                    ({user.tier})
                  </span>
                  <span className="text-muted-foreground/50">&#9662;</span>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-xl z-50 py-1">
                    <div className="px-3 py-2 border-b border-border">
                      <div className="text-sm font-medium">{user.display_name}</div>
                      <div className={`text-xs ${tierColors[user.tier] || "text-muted-foreground"}`}>
                        {user.tier.charAt(0).toUpperCase() + user.tier.slice(1)} Plan
                      </div>
                    </div>
                    {user.tier !== "free" && (
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                        onClick={async () => {
                          const res = await fetch("/api/billing-portal", { method: "POST", credentials: "include" });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                        }}
                      >
                        Manage Subscription
                      </button>
                    )}
                    {user.tier === "free" && (
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-muted cursor-pointer"
                        onClick={async () => {
                          const res = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan: "basic" }) });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                        }}
                      >
                        Upgrade to Basic — $5/mo
                      </button>
                    )}
                    <a
                      href="/auth/logout"
                      className="block px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-red-400 cursor-pointer"
                    >
                      Sign Out
                    </a>
                  </div>
                )}
              </div>
            </>
          ) : (
            <a
              href="/auth/steam"
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z" /></svg>
              Sign In
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
