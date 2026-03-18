import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/blog", label: "Blog" },
];

interface NavUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
}

export function SiteNav() {
  const location = useLocation();
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.steam_id) setUser(data); })
      .catch(() => {});
  }, []);

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight hover:opacity-80 transition-opacity">
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
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              >
                Dashboard
              </Link>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {user.avatar_url && <img src={user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
                <span className="hidden md:inline">{user.display_name}</span>
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
