import { useEffect, useRef, useState } from "react";
import { useCurrency, SUPPORTED_CURRENCIES, CURRENCY_META, type Currency } from "../contexts/CurrencyContext.js";

export function CurrencyPicker() {
  const { currency, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const meta = CURRENCY_META[currency];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (c: Currency) => { setCurrency(c); setOpen(false); };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Display currency"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-8 px-2 text-xs font-medium bg-transparent border border-border rounded-md text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer"
      >
        <span className="text-sm leading-none">{meta.flag}</span>
        <span className="tabular-nums">{currency}</span>
        <span className="text-muted-foreground/80 tabular-nums">{meta.symbol}</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Select currency"
          className="absolute right-0 top-full mt-1.5 w-32 max-h-80 overflow-y-auto rounded-md border border-border bg-background/95 backdrop-blur-md shadow-lg py-1 z-50"
        >
          {SUPPORTED_CURRENCIES.map(code => {
            const m = CURRENCY_META[code];
            const active = code === currency;
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(code)}
                className={
                  "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors " +
                  (active
                    ? "bg-foreground/5 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")
                }
              >
                <span className="text-base leading-none w-5 shrink-0">{m.flag}</span>
                <span className="font-medium w-9 tabular-nums shrink-0">{code}</span>
                <span className="text-muted-foreground/80 tabular-nums shrink-0">{m.symbol}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
