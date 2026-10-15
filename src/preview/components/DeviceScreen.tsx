/**
 * Illustrative example stills for the landing device frames.
 * Sample layouts with round figures, not a capture of the live board.
 */
const SHOTS = {
  desktop: {
    dark: "/preview/board-desktop-dark.webp",
    light: "/preview/board-desktop-light.webp",
  },
  mobile: {
    dark: "/preview/board-mobile-dark.webp",
    light: "/preview/board-mobile-light.webp",
  },
} as const;

export function DeviceScreen({
  compact = false,
  mode = "dark",
}: {
  compact?: boolean;
  mode?: "light" | "dark";
}) {
  const src = SHOTS[compact ? "mobile" : "desktop"][mode];
  return (
    <div className={`tub-shot ${compact ? "tub-shot--phone" : ""}`}>
      <img src={src} alt="Illustrative example of the TradeUpBot board." referrerPolicy="strict-origin" />
    </div>
  );
}
