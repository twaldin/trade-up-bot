/**
 * Preview-only brand mark. Same crosshair as the production favicon, drawn on
 * the Outlay lime with no plate behind it — production `public/favicon.svg`
 * keeps its own mark and is not touched from here.
 */
export function PreviewMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="preview-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="9" />
      <circle cx="16" cy="16" r="4.5" />
      <line x1="16" y1="4" x2="16" y2="10" strokeLinecap="round" />
      <line x1="16" y1="22" x2="16" y2="28" strokeLinecap="round" />
      <line x1="4" y1="16" x2="10" y2="16" strokeLinecap="round" />
      <line x1="22" y1="16" x2="28" y2="16" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
