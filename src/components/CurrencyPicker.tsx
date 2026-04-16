import { useCurrency, SUPPORTED_CURRENCIES } from "../contexts/CurrencyContext.js";

export function CurrencyPicker() {
  const { currency, setCurrency } = useCurrency();
  return (
    <select
      value={currency}
      onChange={(e) => setCurrency(e.target.value as typeof currency)}
      className="h-8 px-1.5 text-xs bg-transparent border border-border rounded-md text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
      title="Display currency"
    >
      {SUPPORTED_CURRENCIES.map(c => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}
