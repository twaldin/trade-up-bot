/**
 * The device frames show a real capture of `/preview/trade-ups`, not live HTML
 * and not an invented chart. `scripts/preview-capture-device.mjs` refreshes the
 * four stills (desktop/mobile × dark/light) from the running preview host at
 * the end of a pass, so the lid always shows what shipped.
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
      <img src={src} alt="The TradeUpBot board: input and output skins, payoff strip, and live listings." />
    </div>
  );
}
