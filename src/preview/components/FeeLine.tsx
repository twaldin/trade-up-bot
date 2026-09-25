import type { FeeLineCopy } from "../lib/fees.js";
import { REPRICE_CAVEAT } from "../lib/copy.js";

export function FeeLine({ line, className, caveat }: { line: FeeLineCopy; className?: string; caveat?: boolean }) {
  return (
    <>
      <p className={`preview-fees ${className ?? ""}`}>
        <span className="preview-fees__label">Fees</span>
        <span>{line.cost}</span>
        <span>{line.outcomes}</span>
      </p>
      {caveat ? <p className="preview-note">{REPRICE_CAVEAT}</p> : null}
    </>
  );
}
