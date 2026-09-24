/**
 * Why a high chance of profit can still sit next to a negative expected P/L.
 * Chance counts winning outcomes. Expected P/L weights the losses too.
 */
export const EXPECTED_PL_HELP =
  "Chance of profit counts how often you come out ahead. Expected P/L also weighs how much you lose on the other outcomes, so it can be negative even when profit is likely.";

export function ExpectedPlHelp() {
  return (
    <p className="preview-note preview-pl-help" title={EXPECTED_PL_HELP}>
      {EXPECTED_PL_HELP}
    </p>
  );
}
