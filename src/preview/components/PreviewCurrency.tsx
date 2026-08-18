/**
 * Outlay currency control. The production picker is built from shadcn utility
 * classes on a different radius and text scale, and restyling it in place would
 * bleed into production, so preview drives the same currency context with its
 * own markup.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  CURRENCY_META,
  SUPPORTED_CURRENCIES,
  useCurrency,
  type Currency,
} from "../../contexts/CurrencyContext.js";

export function PreviewCurrency() {
  const { currency, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const meta = CURRENCY_META[currency];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="preview-currency" ref={rootRef}>
      <button
        type="button"
        className="preview-btn preview-currency__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Display currency"
      >
        <span aria-hidden>{meta.flag}</span>
        <span className="preview-currency__code">{currency}</span>
        <span className="preview-currency__sym">{meta.symbol}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="preview-menu" role="listbox" aria-label="Select currency">
          {SUPPORTED_CURRENCIES.map((code) => {
            const item = CURRENCY_META[code];
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={code === currency}
                className="preview-menu__item"
                onClick={() => {
                  setCurrency(code as Currency);
                  setOpen(false);
                }}
              >
                <span aria-hidden>{item.flag}</span>
                <span className="preview-menu__code">{code}</span>
                <span className="preview-menu__sym">{item.symbol}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
