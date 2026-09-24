export const EXPECTED_PL_HELP =
  "Expected P/L is expected value after fees minus cost, averaged across every outcome by its probability. Outcomes above cost shows how likely an outcome is to land above cost, not how far. A few outcomes far below cost can make Expected P/L negative even when most outcomes are above cost.";

export const EXPECTED_PL_TOOLTIP =
  "Expected P/L: expected value after fees minus cost, averaged across outcomes by probability. Can be negative even when most outcomes are above cost.";

/** The paragraph appears only when expected P/L is negative and most outcomes land above cost. */
export function showExpectedPlHelp(evPnLCents: number, outcomesAboveCost: number | null): boolean {
  return evPnLCents < 0 && outcomesAboveCost !== null && outcomesAboveCost >= 0.5;
}

export function ExpectedPlHelp() {
  return (
    <p className="preview-note preview-pl-help">
      {EXPECTED_PL_HELP}
    </p>
  );
}
