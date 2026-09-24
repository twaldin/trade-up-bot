import type { FeeLineCopy } from "../lib/fees.js";

export function FeeLine({ line, className }: { line: FeeLineCopy; className?: string }) {
  return (
    <p className={`preview-fees ${className ?? ""}`}>
      <span className="preview-fees__label">Fees</span>
      <span>{line.cost}</span>
      <span>{line.outcomes}</span>
    </p>
  );
}
