import { assertCleanCopy } from "./copy/guard";
import { captureDate, need, readout, take, WEAR, type Facts, type Take } from "./facts";
import type { ScreenAdProps } from "./compositions/ScreenAd";
import type { StaticAdProps } from "./compositions/StaticAd";
import type { Focus } from "./components/Footage";
import { DIMENSIONS, FPS, type Format } from "./theme";

const HONESTY = "Estimates after fees. You can lose money.";

type Rect = { x: number; y: number; w: number; h: number };

const rect = (t: Take, name: string): Rect => {
  const r = t.rects?.[name];
  if (!r) throw new Error(`take ${t.id} has no rect "${name}"`);
  return r;
};

const center = (r: Rect, extraW = 80): Focus => ({
  cx: r.x + r.w / 2,
  cy: r.y + r.h / 2,
  w: r.w + extraW,
});

/** One cell of the top readout row. A wider window would include the row below it. */
const readoutCell = (r: Rect, col: number): Focus => ({
  cx: r.x + (r.w / 4) * (col + 0.5),
  cy: r.y + r.h * 0.2,
  w: 68,
});

/** Right side of an output tile: the float. The outcome share sits further left. */
const outputFloat = (r: Rect): Focus => ({
  cx: r.x + r.w * 0.8,
  cy: r.y + 18,
  w: 58,
});

const proOffer = (facts: Facts): string => {
  const pricing = facts.takes["d-pricing"]?.facts;
  const card = pricing?.monthly?.card ?? "";
  const match = card.match(/Pro\s+\$(\d+\.\d{2})\/mo/);
  if (!match) throw new Error("Pro monthly price was not read from the live /pricing page.");
  const cancel = pricing?.cancelAnswer ?? "";
  if (!/cancel your subscription at any time/i.test(cancel)) {
    throw new Error("pricing page did not confirm that Pro can be cancelled at any time");
  }
  return `Free tier, then Pro $${match[1]}/mo. Cancel anytime.`;
};

const conditionPrice = (text: string, code: string): string => {
  const match = text.match(new RegExp(`${code}\\n[^\\n]+\\n(\\$\\d+\\.\\d{2})`));
  if (!match) throw new Error(`no ${code} condition price in the captured skin page`);
  return match[1];
};

const dated = (facts: Facts, id: string) =>
  `Captured on tradeupbot.app, ${captureDate(take(facts, id).capturedAt)}.`;

export type VideoJob = {
  id: string;
  width: number;
  height: number;
  durationInFrames: number;
  props: ScreenAdProps;
};

export type StillJob = {
  id: string;
  width: number;
  height: number;
  props: StaticAdProps;
};

const seconds = (props: Pick<ScreenAdProps, "scenes" | "endCard">) =>
  props.scenes.reduce((s, x) => s + x.seconds, 0) + props.endCard.seconds;

const video = (props: ScreenAdProps): VideoJob => {
  assertCleanCopy(props.id, props);
  const total = seconds(props);
  if (total < 15 || total > 20) throw new Error(`${props.id} is ${total}s; videos must be 15–20s`);
  const dim = DIMENSIONS[props.format];
  return { id: props.id, ...dim, durationInFrames: Math.round(total * FPS), props };
};

const still = (props: StaticAdProps): StillJob => {
  assertCleanCopy(props.id, props);
  const dim = DIMENSIONS[props.format === "square" ? "square" : "portrait"];
  return { id: props.id, ...dim, props };
};

const endCard = (facts: Facts, headline: string, cta: string) => ({
  seconds: 3.6,
  headline,
  cta,
  url: "tradeupbot.app",
  offer: proOffer(facts),
  honesty: HONESTY,
});

export const buildCatalog = (facts: Facts) => {
  const board = take(facts, "d-board");
  const skins = take(facts, "d-skins");
  const calc = take(facts, "d-calculator");
  const faq = take(facts, "d-faq");
  const tradeup = take(facts, "d-tradeup");
  const out = need(board.facts.skins?.find((s) => s.kind === "output" && s.name === "Nightwish"), "Nightwish output");
  const wear = WEAR[need(out.wear, "output wear")];
  const ev = readout(board, "Expected value");
  const pl = readout(board, "Expected P/L");
  const cost = readout(board, "Cost");
  const result = need(calc.facts.result, "calculator result");
  const fee = need(faq.facts.feeAnswer, "fee answer");
  const when = dated(facts, "d-board");
  const bsPrice = conditionPrice(need(skins.facts.detailText, "skin page text"), "BS");

  const floatVertical: ScreenAdProps = {
    id: "meta-a-float-vertical",
    angle: "Exact float vs condition average",
    format: "vertical",
    layout: "panel",
    footnote: when,
    takes: facts.takes,
    endCard: endCard(facts, "Price the exact float.", "Open the calculator"),
    scenes: [
      {
        id: "hook",
        seconds: 2.2,
        caption: { text: "A condition average is one price for every float.", emphasis: ["one price"] },
        footage: { kind: "video", take: "d-skins", from: "chart", offset: -0.4, focus: center(rect(skins, "price-by-condition"), 40) },
      },
      {
        id: "condition",
        seconds: 4.2,
        caption: { text: `${wear} ${out.weapon} | ${out.name}, cheapest listing: a condition price.`, emphasis: ["condition price"] },
        footage: { kind: "video", take: "d-skins", from: "chart", offset: 0.6, focus: center(rect(skins, "price-by-condition"), 20) },
        callout: { label: `${wear} · cheapest`, value: bsPrice, note: "Price by condition, live page" },
      },
      {
        id: "float",
        seconds: 4.4,
        caption: { text: `This contract produces float ${out.float}.`, emphasis: [need(out.float, "float")] },
        footage: { kind: "video", take: "d-board", from: "output-float", offset: 0.3, focus: outputFloat(rect(board, "output0")) },
        callout: { label: "Predicted output float", value: need(out.float, "float"), note: `${out.weapon} | ${out.name}` },
      },
      {
        id: "price",
        seconds: 4.6,
        caption: { text: "The listing price is for that float, after fees.", emphasis: ["that float"] },
        footage: { kind: "video", take: "d-board", from: "readouts", offset: 0.4, focus: readoutCell(rect(board, "readouts"), 1) },
        callout: { label: "Expected value · estimate", value: need(ev.value, "ev"), note: `Cost ${cost.value} · P/L ${pl.value} after fees` },
      },
    ],
  };

  const withFormat = (base: ScreenAdProps, format: Format, id: string): ScreenAdProps => ({
    ...base,
    id,
    format,
    scenes: base.scenes.map((s) => ({ ...s })),
  });

  const ugc: ScreenAdProps = {
    id: "meta-b-ugc-vertical",
    angle: "Screen recording, calculator then verify",
    format: "vertical",
    layout: "fullbleed",
    footnote: dated(facts, "d-calculator"),
    takes: facts.takes,
    endCard: endCard(facts, "Fees in. Then verify.", "Try the calculator"),
    scenes: [
      {
        id: "hook",
        seconds: 1.8,
        caption: { text: "Open the calculator.", emphasis: ["calculator"] },
        footage: { kind: "video", take: "d-calculator", from: "empty", focus: { cx: 720, cy: 420, w: 1100 } },
      },
      {
        id: "example",
        seconds: 3.6,
        caption: { text: "Ten live listings. Each one has its own float.", emphasis: ["own float"] },
        footage: { kind: "video", take: "d-calculator", from: "loaded", offset: 0.2, focus: center(rect(calc, "inputs"), 60) },
      },
      {
        id: "result",
        seconds: 4.4,
        caption: { text: "After fees, the worked example loses a cent.", emphasis: ["loses a cent"] },
        footage: { kind: "video", take: "d-calculator", from: "result-in-view", offset: -0.3, focus: center(rect(calc, "result"), 200) },
        callout: {
          label: "Estimate after fees",
          value: need(result.profit, "profit"),
          note: `Cost ${result.cost} · expected value ${result.expectedValue}`,
          tone: "loss",
        },
      },
      {
        id: "fees",
        seconds: 3.4,
        caption: { text: "The fee depends on the marketplace.", emphasis: ["marketplace"] },
        footage: { kind: "video", take: "d-faq", from: "fees-open", offset: 0.3, focus: center(rect(faq, "fee-answer"), 80) },
      },
      {
        id: "verify",
        seconds: 2.6,
        caption: { text: "Then verify the listings are still for sale.", emphasis: ["verify"] },
        footage: { kind: "video", take: "d-board", from: "verify-button", offset: -0.2, focus: center(rect(board, "verify"), 220) },
      },
    ],
  };

  const verify: ScreenAdProps = {
    id: "meta-c-verify-vertical",
    angle: "Verify before you buy",
    format: "vertical",
    layout: "panel",
    footnote: dated(facts, "d-tradeup"),
    takes: facts.takes,
    endCard: endCard(facts, "Verify, then decide.", "See live trade-ups"),
    scenes: [
      {
        id: "hook",
        seconds: 2,
        caption: { text: "A green estimate is not a promise.", emphasis: ["not a promise"] },
        footage: { kind: "video", take: "d-board", from: "listings", offset: 0.2, focus: center(rect(board, "listings"), 40) },
      },
      {
        id: "listings",
        seconds: 4.6,
        caption: { text: "Every input is a listing you can open.", emphasis: ["listing you can open"] },
        footage: { kind: "video", take: "d-board", from: "listings", offset: 1.2, focus: center(rect(board, "listings"), 20) },
        callout: { label: "10 listings · cost", value: need(cost.value, "cost"), note: "CSFloat and DMarket" },
      },
      {
        id: "verify",
        seconds: 4.2,
        caption: { text: "Verify re-checks each one before you buy.", emphasis: ["before you buy"] },
        footage: { kind: "video", take: "d-board", from: "verify-button", focus: center(rect(board, "verify"), 180) },
      },
      {
        id: "signin",
        seconds: 4.6,
        caption: { text: "Verifying asks you to sign in. Listings can already be gone.", emphasis: ["sign in"] },
        footage: { kind: "video", take: "d-tradeup", from: "signin", offset: 0.2, focus: center(rect(tradeup, "signin"), 80) },
      },
    ],
  };

  const videos = [
    video(floatVertical),
    video(withFormat(floatVertical, "square", "meta-a-float-square")),
    video(withFormat(floatVertical, "landscape", "meta-a-float-landscape")),
    video(ugc),
    video(verify),
  ];

  const feeRows = [
    { market: "CSFloat", buyer: "2.8% + $0.30", seller: "2%" },
    { market: "DMarket", buyer: "2.5%", seller: "2%" },
    { market: "Skinport", buyer: "None", seller: "8%" },
    { market: "Buff", buyer: "3.5% + $0.15", seller: "2.5%" },
  ];
  for (const row of feeRows) {
    if (!fee.includes(row.buyer === "None" ? "no buyer fee" : row.buyer.replace(" + ", " + ")) && !fee.includes(row.buyer.split(" ")[0])) {
      throw new Error(`fee row ${row.market} ${row.buyer} is not in the captured FAQ answer`);
    }
  }
  if (!fee.includes(out.weapon ? "2%" : "2%")) throw new Error("fee answer missing seller fees");

  const source = `Source: tradeupbot.app on ${captureDate(board.capturedAt)}.`;
  const designs: Omit<StaticAdProps, "format" | "id" | "takes">[] = [
    {
      angle: "Exact float vs condition average",
      headline: "Same skin. The float changes the price.",
      emphasis: ["float"],
      sub: `${wear} ${out.weapon} | ${out.name} shows one cheapest listing per condition. A contract prices the float it actually produces.`,
      visual: {
        type: "split",
        left: { title: "One price per condition", note: "A flat line. No float, no listing." },
        right: { take: "d-skins", shot: "price-by-condition", title: "Price by condition", note: "Live skin page. Cheapest listing in each condition." },
      },
      cta: "Open the calculator",
      url: "tradeupbot.app/calculator",
      disclaimer: HONESTY,
      source,
    },
    {
      angle: "Exact float vs condition average",
      headline: `Float ${out.float}, not a condition midpoint.`,
      emphasis: [need(out.float, "float")],
      sub: `This contract’s ${out.weapon} | ${out.name} output is float ${out.float} (${wear}). Expected value ${ev.value} on a ${cost.value} cost.`,
        visual: {
        type: "number",
        label: "Predicted output float",
        value: need(out.float, "float"),
        detail: `${out.weapon} | ${out.name} · ${wear}. Expected value ${ev.value}, estimate after fees.`,
        shot: { take: "d-skins", shot: "chart" },
      },
      cta: "Open the calculator",
      url: "tradeupbot.app/calculator",
      disclaimer: HONESTY,
      source,
    },
    {
      angle: "Verify before you buy",
      headline: "Verify the listings before you buy.",
      emphasis: ["Verify"],
      sub: "Each input links to a live listing. Verify re-checks that it is still for sale, and at what price. Signing in is required.",
      visual: {
        type: "listings",
        label: "Inputs on the expanded card",
        rows: need(board.facts.listings, "listings").slice(0, 6).map((row) => ({
          n: need(row.n, "listing n"),
          name: need(row.name, "listing name"),
          market: need(row.market, "listing market"),
          float: need(row.float, "listing float"),
          price: need(row.price, "listing price"),
        })),
      },
      cta: "See live trade-ups",
      url: "tradeupbot.app/trade-ups",
      disclaimer: HONESTY,
      source,
    },
    {
      angle: "Fees in the math",
      headline: "The fee depends on where you buy.",
      emphasis: ["where you buy"],
      sub: "Copied from the live FAQ. Applied per listing, on the way in and on the way out.",
      visual: { type: "fees", label: "Marketplace fees, from the FAQ", rows: feeRows },
      cta: "Open the calculator",
      url: "tradeupbot.app/calculator",
      disclaimer: HONESTY,
      source: `Source: tradeupbot.app/faq on ${captureDate(faq.capturedAt)}.`,
    },
  ];

  const stills: StillJob[] = [];
  for (const format of ["square", "portrait"] as const) {
    designs.forEach((d, i) => {
      const id = `static-${["float-split", "float-number", "verify", "fees"][i]}-${format === "square" ? "1080" : "1350"}`;
      stills.push(still({ ...d, id, format, takes: facts.takes }));
    });
  }

  return { videos, stills, fee, result, out, ev, cost, pl };
};
