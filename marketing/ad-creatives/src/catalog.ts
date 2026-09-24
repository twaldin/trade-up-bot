import { assertCleanCopy } from "./copy/guard";
import { captureDate, need, readout, take, type Facts } from "./facts";
import type { ScreenAdProps } from "./compositions/ScreenAd";
import type { StaticAdProps } from "./compositions/StaticAd";
import { MIN_FOCUS_W } from "./components/Footage";
import { DIMENSIONS, FPS, type Format } from "./theme";
import { EXAMPLE, HONESTY, LIVE } from "./live-read";

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

const MARKET: Record<string, string> = { CF: "CSFloat", DM: "DMarket" };

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
  const { takes, ...copy } = props;
  void takes;
  assertCleanCopy(props.id, copy);
  const total = seconds(props);
  if (total < 15 || total > 20) throw new Error(`${props.id} is ${total}s; videos must be 15–20s`);
  const dim = DIMENSIONS[props.format];
  return { id: props.id, ...dim, durationInFrames: Math.round(total * FPS), props };
};

const still = (props: StaticAdProps): StillJob => {
  const { takes, ...copy } = props;
  void takes;
  assertCleanCopy(props.id, copy);
  const dim = DIMENSIONS[props.format];
  return { id: props.id, ...dim, props };
};

const endCard = (facts: Facts, headline: string, cta: string) => ({
  seconds: 3.6,
  headline,
  cta,
  url: "tradeupbot.app",
  offer: proOffer(facts),
  honesty: HONESTY,
  example: EXAMPLE,
});

export const buildCatalog = (facts: Facts) => {
  const board = take(facts, "d-board");
  const calc = take(facts, "d-calculator");
  const faq = take(facts, "d-faq");
  const tradeup = take(facts, "d-tradeup");
  const ev = readout(board, "Expected value");
  const cost = readout(board, "Cost");
  const result = need(calc.facts.result, "calculator result");
  const fee = need(faq.facts.feeAnswer, "fee answer");
  if (cost.value !== "$53.14" || ev.value !== "$56.35") {
    throw new Error("board cost/EV drifted from the 24 Sept capture used in this pack");
  }
  if (result.cost !== "$27.42" || result.expectedValue !== "$27.41" || result.profit !== "-$0.01") {
    throw new Error("calculator example drifted from the 24 Sept capture");
  }
  if (!/Verify[^.]*Pro/.test(tradeup.facts.signinBanner ?? "")) {
    throw new Error("sign-in banner text was not captured");
  }
  const feeRows = [
    { market: "CSFloat", buyer: "2.8% + $0.30" },
    { market: "DMarket", buyer: "2.5%" },
    { market: "Skinport", buyer: "None" },
    { market: "Buff", buyer: "3.5% + $0.15" },
  ];
  for (const row of feeRows) {
    const needle = row.buyer === "None" ? "no buyer fee" : row.buyer.split(" ")[0];
    if (!fee.includes(needle) && !fee.includes(row.buyer)) throw new Error(`fee row ${row.market} is not in the captured FAQ`);
  }
  if (!fee.includes("$0.30")) throw new Error("FAQ answer is missing the CSFloat flat buyer fee");

  const floatBase: ScreenAdProps = {
    id: "meta-a-float-vertical",
    angle: "Exact float vs a condition price",
    format: "vertical",
    layout: "panel",
    footnote: LIVE.nightwish.label,
    takes: facts.takes,
    endCard: endCard(facts, "Price the exact float.", "Open the calculator"),
    scenes: [
      {
        id: "hook",
        seconds: 2.4,
        caption: { text: `0.07 float: ${LIVE.nightwish.fn} vs ${LIVE.nightwish.mw}`, emphasis: [LIVE.nightwish.fn, LIVE.nightwish.mw] },
        graphic: {
          type: "range",
          stopAt: LIVE.nightwish.marker,
          kicker: "Cheapest listings, 24 Sept 2026",
          rows: [
            { k: "FN", v: LIVE.nightwish.fn },
            { k: "MW", v: LIVE.nightwish.mw },
          ],
          size: 80,
        },
      },
      {
        id: "boundary",
        seconds: 4,
        caption: { text: "Cross 0.07 and the cheapest Nightwish listing drops.", emphasis: ["0.07"] },
        graphic: {
          type: "range",
          stopAt: LIVE.nightwish.marker,
          kicker: LIVE.nightwish.label,
          rows: [
            { k: "FN", v: LIVE.nightwish.fn },
            { k: "MW", v: LIVE.nightwish.mw },
          ],
          size: 72,
        },
        footnote: "Factory New and Minimal Wear. Live skin page, 24 Sept 2026.",
      },
      {
        id: "contract",
        seconds: 4.2,
        caption: { text: "A board contract can land far from that boundary.", emphasis: ["boundary"] },
        graphic: {
          type: "figure",
          kicker: "Output float · AK-47 | Nightwish",
          value: "0.5428",
          note: "Battle-Scarred on contract 780598151. The float is set by the 10 listings.",
          size: 88,
        },
        footnote: EXAMPLE,
      },
      {
        id: "ev",
        seconds: 4.4,
        caption: { text: "Expected value (after fees), both outcomes.", emphasis: ["both outcomes"] },
        graphic: {
          type: "figure",
          kicker: "Expected value (after fees), both outcomes",
          value: need(ev.value, "ev"),
          note: `Cost ${cost.value}. This is not the listing price for that float. Estimate.`,
          size: 88,
        },
        footnote: EXAMPLE,
      },
    ],
  };

  const withFormat = (base: ScreenAdProps, format: Format, id: string): ScreenAdProps => ({
    ...base,
    id,
    format,
    scenes: base.scenes.map((s) => ({ ...s, graphic: s.graphic ? { ...s.graphic } : undefined })),
  });

  const screen: ScreenAdProps = {
    id: "meta-b-screen-vertical",
    angle: "Screen demo",
    format: "vertical",
    layout: "panel",
    footnote: EXAMPLE,
    takes: facts.takes,
    endCard: { ...endCard(facts, "Check the estimate.", "See trade-ups"), seconds: 5 },
    scenes: [
      {
        id: "skip",
        seconds: 2,
        caption: { text: "Skip this one.", emphasis: ["Skip"] },
        graphic: {
          type: "figure",
          kicker: "Calculator example · 24 Sept 2026",
          value: "-$0.01",
          note: `Cost ${result.cost} → expected value (after fees) ${result.expectedValue}.`,
          tone: "loss",
          size: 96,
          motion: true,
        },
        footnote: "Worked example from the calculator. Not the hero.",
      },
      {
        id: "hero",
        seconds: 8,
        caption: { text: "Two outcomes are priced under the cost.", emphasis: ["Two outcomes"] },
        graphic: {
          type: "compare",
          title: `Contract ${LIVE.hero.id} · estimate`,
          left: { k: "Cost", v: LIVE.hero.cost },
          right: { k: "Expected value", v: LIVE.hero.expectedValue },
          rows: LIVE.hero.belowCost.map((row) => ({ k: row.name, v: row.price })),
        },
        footnote: EXAMPLE,
      },
    ],
  };

  const verify: ScreenAdProps = {
    id: "meta-c-verify-vertical",
    angle: "Verify before you buy",
    format: "vertical",
    layout: "panel",
    footnote: EXAMPLE,
    takes: facts.takes,
    endCard: endCard(facts, "Verify is part of Pro.", "See trade-ups"),
    scenes: [
      {
        id: "hook",
        seconds: 2.2,
        caption: { text: "A green estimate is not a promise.", emphasis: ["not a promise"] },
        footage: { kind: "video", take: "d-board", from: "verify-click", offset: -0.9, focus: { cx: 1255, cy: 450, w: Math.max(400, MIN_FOCUS_W) }, pointer: false },
        callout: { label: "across 10 listings", value: need(cost.value, "cost"), valueSize: 72 },
      },
      {
        id: "listings",
        seconds: 4.4,
        caption: { text: "One contract = 10 listings.", emphasis: ["10 listings"] },
        graphic: {
          type: "stack",
          title: "First 6 of 10 · CSFloat and DMarket",
          size: 32,
          rows: need(board.facts.listings, "listings").slice(0, 6).map((row) => {
            const market = MARKET[row.market];
            if (!market) throw new Error(`unknown market code ${row.market}`);
            return { k: `${row.n} ${market}`, v: row.price };
          }),
        },
        footnote: `${EXAMPLE} Total ${cost.value}.`,
      },
      {
        id: "signin",
        seconds: 4.2,
        caption: { text: "The page asks you to sign in.", emphasis: ["sign in"] },
        footage: { kind: "image", take: "d-tradeup", shot: "signin", focus: { cx: 177, cy: 23, w: 360 } },
        footnote: "Signing in is free. Verify is part of Pro.",
      },
      {
        id: "pro",
        seconds: 3.8,
        caption: { text: "Verify is part of Pro.", emphasis: ["Pro"] },
        graphic: {
          type: "figure",
          kicker: "Signed-in free accounts can't run Verify",
          value: "Pro",
          note: "Verify is part of Pro. It re-checks all 10 before you spend.",
          size: 88,
        },
        footnote: "Free view is delayed 3 hours.",
      },
    ],
  };

  const videos = [
    video(floatBase),
    video(withFormat(floatBase, "square", "meta-a-float-square")),
    video(withFormat(floatBase, "portrait", "meta-a-float-portrait")),
    video(screen),
    video(verify),
  ];

  const listings = need(board.facts.listings, "listings").slice(0, 6).map((row) => {
    const market = MARKET[row.market];
    if (!market) throw new Error(`unknown market code ${row.market}`);
    return { n: row.n, name: row.name, market, float: row.float, price: row.price };
  });

  const boundary = (size: number): StaticAdProps["visual"] => ({
    type: "boundary",
    kicker: "Float range · marker at 0.07",
    stopAt: LIVE.nightwish.marker,
    size,
    rows: [
      { k: "FN", v: LIVE.nightwish.fn },
      { k: "MW", v: LIVE.nightwish.mw },
    ],
  });

  const source = `Source: tradeupbot.app, ${LIVE.date}.`;
  const designs: { id: string; formats: ("square" | "portrait" | "vertical")[]; props: Omit<StaticAdProps, "format" | "id" | "takes"> }[] = [
    {
      id: "float-boundary",
      formats: ["square", "portrait", "vertical"],
      props: {
        angle: "Exact float vs a condition price",
        headline: `0.07 float: ${LIVE.nightwish.fn} vs ${LIVE.nightwish.mw}`,
        emphasis: [LIVE.nightwish.fn, LIVE.nightwish.mw],
        sub: LIVE.nightwish.label,
        visual: boundary(72),
        cta: "Open the calculator",
        url: "tradeupbot.app/calculator",
        disclaimer: HONESTY,
        source: LIVE.nightwish.source,
      },
    },
    {
      id: "float-number",
      formats: ["square", "portrait"],
      props: {
        angle: "Exact float vs a condition price",
        headline: "Can your 10 listings reach the float?",
        emphasis: ["10 listings"],
        sub: `Cost ${cost.value} · Expected value (after fees) ${ev.value} across both outcomes · estimate`,
        visual: {
          type: "number",
          label: "Predicted output float · AK-47 | Nightwish",
          value: "0.5428",
          detail: "Battle-Scarred on the 24 Sept board example. The expected value covers both outcomes.",
        },
        cta: "Open the calculator",
        url: "tradeupbot.app/calculator",
        disclaimer: HONESTY,
        source: EXAMPLE,
      },
    },
    {
      id: "verify",
      formats: ["square", "portrait"],
      props: {
        angle: "Verify before you buy",
        headline: "$53.14 across 10 listings. Check all 10.",
        emphasis: ["Check all 10"],
        sub: "One contract = 10 listings (first 6 shown). Verify is part of Pro. Free view is delayed 3 hours.",
        visual: { type: "listings", label: "CSFloat and DMarket", rows: listings },
        cta: "See trade-ups",
        url: "tradeupbot.app/trade-ups",
        disclaimer: HONESTY,
        source: EXAMPLE,
      },
    },
    {
      id: "fees",
      formats: ["square", "portrait"],
      props: {
        angle: "Fees in the math",
        headline: "Ten CSFloat buys: $3.00 in flat fees",
        emphasis: ["$3.00"],
        sub: "CSFloat adds 2.8% + $0.30 to every buy. Ten inputs is $3.00 in flat fees before the 2.8%.",
        visual: {
          type: "fees",
          label: "Buyer fees, from the live FAQ",
          rows: feeRows,
          note: "Board adds each market's buyer fee. Outcomes netted at CSFloat's 2% seller fee.",
        },
        cta: "See trade-ups",
        url: "tradeupbot.app/trade-ups",
        disclaimer: HONESTY,
        source: `Source: tradeupbot.app/faq on ${captureDate(faq.capturedAt)}.`,
      },
    },
  ];

  const suffix: Record<Format, string> = { square: "1080", portrait: "1350", vertical: "1920", landscape: "1920x1080" };
  const stills: StillJob[] = [];
  for (const d of designs) {
    for (const format of d.formats) {
      const visual = d.id === "float-boundary" ? boundary(format === "square" ? 64 : 80) : d.props.visual;
      stills.push(still({ ...d.props, visual, id: `static-${d.id}-${suffix[format]}`, format, takes: facts.takes }));
    }
  }

  return { videos, stills, fee, result, ev, cost };
};
