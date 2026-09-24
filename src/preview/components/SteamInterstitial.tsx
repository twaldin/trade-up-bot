import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Link } from "react-router-dom";
import { authHref } from "../../lib/ref.js";
import { PRO_FEATURES, proPriceParts } from "../lib/pro-pricing.js";
import {
  INTERSTITIAL_COPY,
  createInterstitialTracker,
  type DismissMethod,
  type InterstitialContext,
  type InterstitialTracker,
} from "../lib/steam-interstitial.js";

const COPY = INTERSTITIAL_COPY;

const SteamGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const FOCUSABLE = "a[href], button:not([disabled])";

export interface SteamInterstitialProps {
  context: InterstitialContext | null;
  onContinue: () => void;
  onDismiss: (method: DismissMethod) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}

/** Opens the interstitial from a click handler so view events fire once per open, never from an effect. */
export function useSteamInterstitial() {
  const trackerRef = useRef<InterstitialTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = createInterstitialTracker();
  const tracker = trackerRef.current;
  const triggerRef = useRef<HTMLElement | null>(null);
  const [context, setContext] = useState<InterstitialContext | null>(null);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      tracker.reset();
      setContext(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [tracker]);

  const open = useCallback((next: InterstitialContext, trigger: HTMLElement | null) => {
    if (!tracker.open(next)) return;
    triggerRef.current = trigger;
    setContext(next);
  }, [tracker]);

  const dialog: SteamInterstitialProps = {
    context,
    onContinue: () => tracker.continue(),
    onDismiss: (method) => {
      tracker.dismiss(method);
      setContext(null);
    },
    returnFocusTo: triggerRef,
  };

  return { open, dialog };
}

export function SteamInterstitial({ context, onContinue, onDismiss, returnFocusTo }: SteamInterstitialProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLAnchorElement>(null);
  const pressedBackdrop = useRef(false);
  const live = useRef(context);
  live.current = context;
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (context && !dialog.open) {
      dialog.showModal();
      continueRef.current?.focus();
    } else if (!context && dialog.open) {
      dialog.close();
      returnFocusTo.current?.focus();
    }
  }, [context, returnFocusTo]);

  const trapTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="preview-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss("esc");
      }}
      onClose={() => {
        if (live.current) onDismiss("esc");
      }}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBackdrop.current) onDismiss("backdrop");
        pressedBackdrop.current = false;
      }}
      onKeyDown={trapTab}
    >
      {context && (
        <div className="preview-sheet__card">
          <header className="preview-sheet__head">
            <h2 id={titleId}>{context.surface === "pricing_go_pro" ? COPY.pro.title : COPY.claim.title}</h2>
            <button type="button" className="preview-btn preview-btn--quiet preview-sheet__x" aria-label="Close" onClick={() => onDismiss("close")}>
              <IconClose />
            </button>
          </header>

          <div id={bodyId} className="preview-sheet__body">
            {context.surface === "pricing_go_pro" ? (
              <>
                <p className="preview-sheet__price">
                  <b>{proPriceParts(context.billing).amount}</b>
                  <span>{proPriceParts(context.billing).rest}</span>
                </p>
                <section>
                  <p className="o-kicker">{COPY.pro.unlocks}</p>
                  <ul className="preview-plan__list">
                    {PRO_FEATURES.map((feature) => (
                      <li key={feature}><IconCheck /> {feature}</li>
                    ))}
                  </ul>
                  <p className="preview-sheet__muted">{COPY.pro.freeStays}</p>
                </section>
              </>
            ) : (
              <>
                <p><b>Verify</b> {COPY.claim.verify}</p>
                <p><b>Claim</b> {COPY.claim.claim}</p>
                <p>
                  {COPY.claim.plan}{" "}
                  <Link className="preview-link" to="/pricing" onClick={() => onDismiss("compare_plans")}>{COPY.claim.comparePlans}</Link>
                </p>
              </>
            )}
            <section>
              <p className="o-kicker">Why Steam</p>
              <p>{COPY.steamWhy}</p>
            </section>
            <section>
              <p className="o-kicker">Next</p>
              <p>{context.surface === "pricing_go_pro" ? COPY.pro.next : COPY.claim.next}</p>
            </section>
            {context.surface === "pricing_go_pro" && (
              <p className="preview-sheet__muted">{context.billing === "lifetime" ? COPY.pro.lifetime : COPY.pro.cancel}</p>
            )}
          </div>

          <div className="preview-sheet__actions">
            <a
              ref={continueRef}
              className="preview-btn preview-btn--lime preview-sheet__go"
              href={authHref(window.location.pathname)}
              rel="nofollow"
              onClick={onContinue}
              onAuxClick={(event) => {
                if (event.button === 1) onContinue();
              }}
            >
              <SteamGlyph />
              {COPY.continue}
            </a>
            <button type="button" className="preview-btn" onClick={() => onDismiss("cancel")}>
              {COPY.notNow}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
