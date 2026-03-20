import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

// Fetch fonts once at startup (satori needs ttf/otf, not woff/woff2)
let fontsLoaded: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontsLoaded) return fontsLoaded;
  // Google Fonts API returns TTF when requested with a non-woff2-capable user-agent
  const css = await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;700", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)" },
  }).then(r => r.text());
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
  // First match is 400, second is 700
  const [regular, bold] = await Promise.all(urls.slice(0, 2).map(u => fetch(u).then(r => r.arrayBuffer())));
  fontsLoaded = { regular, bold };
  return fontsLoaded;
}

// Pre-load fonts immediately
loadFonts().catch(e => console.error("Font load failed:", e));

const TYPE_LABELS: Record<string, string> = {
  covert_knife: "Knife / Gloves",
  classified_covert: "Covert",
  restricted_classified: "Classified",
  milspec_restricted: "Restricted",
  industrial_milspec: "Mil-Spec",
  consumer_industrial: "Industrial",
  staircase: "Staircase",
};

const TYPE_COLORS: Record<string, string> = {
  covert_knife: "#eab308",
  classified_covert: "#ef4444",
  restricted_classified: "#ec4899",
  milspec_restricted: "#a855f7",
  industrial_milspec: "#3b82f6",
  consumer_industrial: "#38bdf8",
  staircase: "#eab308",
};

function fmt(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const str = abs >= 1000 ? abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : abs.toFixed(2);
  return cents < 0 ? `-$${str}` : `$${str}`;
}

// satori uses React-like element objects — build them without JSX
function h(type: string, props: Record<string, any> | null, ...children: any[]): any {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children.length > 0 ? children : undefined } };
}

interface TradeUpData {
  id: number;
  type: string;
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  inputs: { skin_name: string; condition: string; collection_name: string }[];
}

function buildInputSummary(inputs: TradeUpData["inputs"]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const inp of inputs) {
    counts.set(inp.skin_name, (counts.get(inp.skin_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function buildCollections(inputs: TradeUpData["inputs"]): string[] {
  return [...new Set(inputs.map(i => i.collection_name))].map(c =>
    c.replace(/^The /, "").replace(/ Collection$/, "")
  );
}

export async function generateOgImage(data: TradeUpData): Promise<Buffer> {
  const typeLabel = TYPE_LABELS[data.type] || data.type;
  const typeColor = TYPE_COLORS[data.type] || "#888";
  const inputSummary = buildInputSummary(data.inputs);
  const collections = buildCollections(data.inputs);
  const chance = Math.round((data.chance_to_profit ?? 0) * 100);
  const profitColor = data.profit_cents >= 0 ? "#22c55e" : "#ef4444";
  const roiColor = data.roi_percentage >= 0 ? "#22c55e" : "#ef4444";
  const chanceColor = chance >= 50 ? "#22c55e" : chance >= 30 ? "#fbbf24" : "#ef4444";
  const bestColor = data.best_case_cents >= 0 ? "#22c55e" : "#ef4444";
  const worstColor = data.worst_case_cents >= 0 ? "#22c55e" : "#ef4444";

  const inputText = inputSummary.map(s => `${s.count}x ${s.name}`).join(", ");

  // Stat cell helper
  const stat = (label: string, value: string, color: string, bold = false) =>
    h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" } },
      h("div", { style: { fontSize: "14px", color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.05em" } }, label),
      h("div", { style: { fontSize: "28px", fontWeight: bold ? 700 : 600, color } }, value),
    );

  const element = h("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      width: "1200px",
      height: "630px",
      backgroundColor: "#0a0a0a",
      padding: "44px 52px",
      fontFamily: "Inter",
      color: "#e5e5e5",
      justifyContent: "space-between",
    },
  },
    // Top section
    h("div", { style: { display: "flex", flexDirection: "column" } },
      // Branding + type badge
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" } },
        h("div", { style: { fontSize: "24px", fontWeight: 700, color: "#e5e5e5" } }, "TradeUpBot"),
        h("div", {
          style: {
            display: "flex",
            alignItems: "center",
            padding: "8px 20px",
            borderRadius: "20px",
            border: `1.5px solid ${typeColor}40`,
            backgroundColor: `${typeColor}18`,
            color: typeColor,
            fontSize: "17px",
            fontWeight: 600,
          },
        }, `${typeLabel} Trade-Up`),
      ),

      // Input skins row
      h("div", {
        style: {
          display: "flex",
          fontSize: "26px",
          color: "#d4d4d4",
          marginBottom: "14px",
          lineHeight: 1.3,
        },
      }, inputText.length > 70 ? inputText.slice(0, 67) + "..." : inputText),

      // Collection badges
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" as const } },
        ...collections.map(col =>
          h("div", {
            style: {
              display: "flex",
              padding: "5px 12px",
              borderRadius: "5px",
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              color: "#94a3b8",
              fontSize: "14px",
            },
          }, col)
        ),
      ),
    ),

    // Stats grid — main metrics (fills middle)
    h("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#141414",
        border: "1px solid #262626",
        borderRadius: "14px",
        padding: "36px 48px",
      },
    },
      stat("Profit", fmt(data.profit_cents), profitColor, true),
      stat("ROI", `${data.roi_percentage.toFixed(1)}%`, roiColor),
      stat("Chance", `${chance}%`, chanceColor),
      stat("Cost", fmt(data.total_cost_cents), "#d4d4d4"),
      stat("EV", fmt(data.expected_value_cents), "#d4d4d4"),
      stat("Best", fmt(data.best_case_cents), bestColor),
      stat("Worst", fmt(data.worst_case_cents), worstColor),
    ),

    // Footer
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
      h("div", { style: { fontSize: "16px", color: "#6b7280" } }, "tradeupbot.app"),
      h("div", { style: { fontSize: "16px", color: "#6b7280" } }, `Trade-Up #${data.id}`),
    ),
  );

  const fonts = await loadFonts();
  const svg = await satori(element as ReactNode, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400, style: "normal" as const },
      { name: "Inter", data: fonts.bold, weight: 700, style: "normal" as const },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width" as const, value: 1200 } });
  return Buffer.from(resvg.render().asPng());
}
