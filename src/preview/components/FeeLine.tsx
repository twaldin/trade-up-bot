import type { FeeLineCopy } from "../lib/fees.js";
import { REPRICE_CAVEAT } from "../lib/copy.js";

export function FeeLine({ line, className }: { line: FeeLineCopy; className?: string }) {
  return (
    <>
      <p className={`preview-fees ${className ?? ""}`}>
        <span className="preview-fees__label">Fees</span>
        <span>{line.cost}</span>
        <span>{line.outcomes}</span>
      </p>
      <p className="preview-note">{REPRICE_CAVEAT}</p>
    </>
  );
}
