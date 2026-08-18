import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { useCurrency, SUPPORTED_CURRENCIES, CURRENCY_META, type Currency } from "../../contexts/CurrencyContext.js";
import type { PreviewUser } from "./preview-user.js";

export function PreviewAccountMenu({ user }: { user: PreviewUser | null }) {
  const [open, setOpen] = useState<"account" | "currency" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { currency, setCurrency } = useCurrency();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={rootRef} style={{ display: "flex", gap: 8 }}>
      <div className="pv-menu">
        <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setOpen(o => o === "currency" ? null : "currency")}>
          {currency}
        </button>
        {open === "currency" && (
          <div className="pv-dropdown" role="listbox" aria-label="Currency">
            {SUPPORTED_CURRENCIES.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => { setCurrency(code as Currency); setOpen(null); }}
              >
                {CURRENCY_META[code].flag} {code}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pv-menu">
        <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setOpen(o => o === "account" ? null : "account")}>
          {user ? user.display_name : "Account"}
        </button>
        {open === "account" && (
          <div className="pv-dropdown">
            {user ? (
              <>
                <div style={{ padding: "8px 10px", fontSize: 12 }} className="pv-muted">
                  {user.tier} plan
                </div>
                <Link to="/preview/account" onClick={() => setOpen(null)}>Account</Link>
                <a href="/auth/logout" rel="nofollow">Sign out</a>
              </>
            ) : (
              <>
                <Link to="/preview/account" onClick={() => setOpen(null)}>Open account</Link>
                <a
                  href={authHref("/preview/account")}
                  rel="nofollow"
                  onClick={() => trackEvent("sign_up_start", { location: "preview_account_menu" })}
                >
                  Sign in with Steam
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
