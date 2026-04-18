import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "BRL", "CNY", "RUB", "TRY", "PLN",
  "UAH", "KRW", "INR", "CAD", "AUD", "ARS", "MXN", "SEK",
] as const;
export type Currency = typeof SUPPORTED_CURRENCIES[number];

interface CurrencyMeta { flag: string; symbol: string; label: string; }
export const CURRENCY_META: Record<Currency, CurrencyMeta> = {
  USD: { flag: "🇺🇸", symbol: "$",   label: "US Dollar" },
  EUR: { flag: "🇪🇺", symbol: "€",   label: "Euro" },
  GBP: { flag: "🇬🇧", symbol: "£",   label: "British Pound" },
  JPY: { flag: "🇯🇵", symbol: "¥",   label: "Japanese Yen" },
  BRL: { flag: "🇧🇷", symbol: "R$",  label: "Brazilian Real" },
  CNY: { flag: "🇨🇳", symbol: "¥",   label: "Chinese Yuan" },
  RUB: { flag: "🇷🇺", symbol: "₽",   label: "Russian Ruble" },
  TRY: { flag: "🇹🇷", symbol: "₺",   label: "Turkish Lira" },
  PLN: { flag: "🇵🇱", symbol: "zł",  label: "Polish Złoty" },
  UAH: { flag: "🇺🇦", symbol: "₴",   label: "Ukrainian Hryvnia" },
  KRW: { flag: "🇰🇷", symbol: "₩",   label: "Korean Won" },
  INR: { flag: "🇮🇳", symbol: "₹",   label: "Indian Rupee" },
  CAD: { flag: "🇨🇦", symbol: "CA$", label: "Canadian Dollar" },
  AUD: { flag: "🇦🇺", symbol: "A$",  label: "Australian Dollar" },
  ARS: { flag: "🇦🇷", symbol: "AR$", label: "Argentine Peso" },
  MXN: { flag: "🇲🇽", symbol: "MX$", label: "Mexican Peso" },
  SEK: { flag: "🇸🇪", symbol: "kr",  label: "Swedish Krona" },
};

const RATES_CACHE_KEY = "currency_rates_cache";
const SELECTED_KEY = "selected_currency";
const CACHE_TTL = 3_600_000;

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  convert: (usdCents: number) => number;
  formatPrice: (usdCents: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "USD",
  setCurrency: () => {},
  convert: (c) => c,
  formatPrice: (c) => new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(c / 100),
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    try {
      const stored = localStorage.getItem(SELECTED_KEY);
      if (stored && (SUPPORTED_CURRENCIES as readonly string[]).includes(stored)) return stored as Currency;
    } catch {}
    return "USD";
  });
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, number> };
        if (Date.now() - ts < CACHE_TTL) {
          setRates(data);
          return;
        }
      }
    } catch {}
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json())
      .then((d: { rates?: Record<string, number> }) => {
        if (d.rates) {
          setRates(d.rates);
          try {
            localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d.rates }));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem(SELECTED_KEY, c); } catch {}
  }, []);

  const convert = useCallback((usdCents: number): number => {
    return usdCents * (rates[currency] ?? 1);
  }, [currency, rates]);

  const formatPrice = useCallback((usdCents: number): string => {
    const rate = rates[currency] ?? 1;
    const value = (usdCents * rate) / 100;
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
  }, [currency, rates]);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, convert, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
