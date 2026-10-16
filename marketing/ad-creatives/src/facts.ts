import { staticFile } from "remotion";

export type TakeEvent =
  | { type: "move-start" | "move-end" | "click" | "tap"; t: number; x: number; y: number };

export type Screenshot = { file: string; cssWidth: number; cssHeight: number };

export type SkinTile = {
  kind: "input" | "output";
  price: string | null;
  float: string | null;
  wear: string | null;
  weapon: string | null;
  name: string | null;
  delta: string | null;
  skinHref: string | null;
};

export type Readout = { label: string | null; value: string | null; note: string | null };

export type Listing = { n: string; name: string; market: string; float: string; price: string; href: string };

export type PlanPrice = { price: string; card: string } | null;

/** Everything the capture script read off the live page during a take. */
export type TakeFacts = {
  skins?: SkinTile[];
  readouts?: Readout[];
  cardline?: string | null;
  verifyHref?: string | null;
  listings?: Listing[];
  listingsText?: string;
  title?: string;
  signinBanner?: string;
  result?: { cost: string | null; expectedValue: string | null; profit: string | null };
  detailUrl?: string;
  detailText?: string;
  feeAnswer?: string;
  feeQuestion?: string;
  monthly?: PlanPrice;
  yearly?: PlanPrice;
  lifetime?: PlanPrice;
  cancelAnswer?: string;
  verifyCopy?: string;
  hero?: { h1?: string; block?: string };
};

export type Take = {
  id: string;
  device: "desktop" | "mobile";
  url: string;
  file: string;
  width: number;
  height: number;
  duration: number;
  dpr: number;
  viewport: { width: number; height: number };
  capturedAt: string;
  events: TakeEvent[];
  markers: Record<string, number>;
  rects?: Record<string, { x: number; y: number; w: number; h: number; t: number }>;
  screenshots: Record<string, Screenshot>;
  facts: TakeFacts;
};

export type Facts = { base: string; capturedAt: string; takes: Record<string, Take> };

export const loadFacts = async (): Promise<Facts> => {
  const res = await fetch(staticFile("captures/facts.json"));
  if (!res.ok) {
    throw new Error("public/captures/facts.json missing — run `npm run capture` first.");
  }
  return (await res.json()) as Facts;
};

export const take = (facts: Facts, id: string): Take => {
  const t = facts.takes[id];
  if (!t) throw new Error(`take "${id}" not captured`);
  return t;
};

export const need = <T,>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined || value === "") {
    throw new Error(`capture is missing ${what} — refusing to render an invented value`);
  }
  return value;
};

export const readout = (t: Take, label: string): Readout =>
  need(t.facts.readouts?.find((r) => r.label === label), `readout "${label}" in ${t.id}`);

export const WEAR: Record<string, string> = {
  FN: "Factory New",
  MW: "Minimal Wear",
  FT: "Field-Tested",
  WW: "Well-Worn",
  BS: "Battle-Scarred",
};

/** "24 Sep 2026" from an ISO timestamp (UTC, so it matches the capture log). */
export const captureDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
