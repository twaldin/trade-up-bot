import { loadFont as loadBody } from "@remotion/google-fonts/SchibstedGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/DMMono";

// Tokens read from the live site's dark "Outlay" system (computed styles on
// tradeupbot.app, [data-system="outlay"][data-mode="dark"]).
export const C = {
  bg: "#111110",
  panel: "#1c1b19",
  overlay: "#262523",
  sunken: "#0d0d0c",
  lineSoft: "#2a2827",
  lineHard: "#3d3b37",
  text: "#eeece7",
  muted: "#918f8b",
  subtle: "#747370",
  accent: "#d7fe52",
  accentText: "#b6cf5e",
  onAccent: "#000000",
  loss: "#ff5470",
} as const;

const body = loadBody("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const FONT = {
  body: body.fontFamily,
  mono: mono.fontFamily,
};

export type Format = "vertical" | "square" | "landscape" | "portrait";

export const DIMENSIONS: Record<Format, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1350 },
};

export const FPS = 30;

/** Same band as y 270–1250 on a 1920-tall canvas, scaled to other heights. */
export const safeBand = (height: number) => ({
  top: Math.round((height * 270) / 1920),
  bottom: Math.round((height * 1250) / 1920),
});
