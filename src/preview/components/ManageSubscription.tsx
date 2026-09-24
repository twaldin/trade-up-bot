import { useEffect, useState } from "react";
import { openBillingPortal } from "../lib/billing.js";

/** Opens the Stripe billing portal (change plan, update card, cancel at period end). */
export function ManageSubscription({ className = "preview-btn preview-btn--quiet" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const message = await openBillingPortal();
          if (message) {
            setError(message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening billing…" : "Manage subscription"}
      </button>
      {error && <span className="preview-note preview-note--loss" role="alert">{error}</span>}
    </>
  );
}
