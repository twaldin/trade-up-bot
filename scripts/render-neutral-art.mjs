/**
 * Renders the neutral share image and the landing device stills.
 *
 *   node scripts/render-neutral-art.mjs
 *
 * Source SVGs land in assets/neutral-art/. Rasters land in public/.
 * Fonts are the vendored Inter files next to this script's output (SIL OFL).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(root, "assets", "neutral-art");
const fontDir = path.join(artDir, "fonts");
const publicDir = path.join(root, "public");

const CLASSIFIED = "#d32ce6";

const themes = {
  dark: {
    bg: "#111110",
    panel: "#1c1b19",
    nest: "#262523",
    line: "#2a2827",
    lineHard: "#3d3b37",
    text: "#eeece7",
    muted: "#918f8b",
    profit: "#b6cf5e",
    accent: "#d7fe52",
  },
  light: {
    bg: "#ffffff",
    panel: "#f8f5f2",
    nest: "#eeebe8",
    line: "#d9d8d5",
    lineHard: "#acaba8",
    text: "#0b0b0a",
    muted: "#6a6866",
    profit: "#5a6b22",
    accent: "#d7fe52",
  },
};

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function crosshair(x, y, size, stroke) {
  const scale = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="1.8">
    <circle cx="16" cy="16" r="9"/>
    <circle cx="16" cy="16" r="4.5"/>
    <line x1="16" y1="4" x2="16" y2="10" stroke-linecap="round"/>
    <line x1="16" y1="22" x2="16" y2="28" stroke-linecap="round"/>
    <line x1="4" y1="16" x2="10" y2="16" stroke-linecap="round"/>
    <line x1="22" y1="16" x2="28" y2="16" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="1.8" fill="${stroke}" stroke="none"/>
  </g>`;
}

function text(x, y, value, { size = 13, fill, weight = 400, anchor = "start" }) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Inter" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${esc(value)}</text>`;
}

function chip(x, y, label, theme) {
  const width = Math.ceil(label.length * 7.1) + 20;
  const height = 26;
  return {
    width,
    markup: `<g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${theme.accent}"/>
      ${text(x + 10, y + 17, label, { size: 12, fill: "#000000", weight: 700 })}
    </g>`,
  };
}

function tile(x, y, w, h, theme, { rarity, title, meta, figure, figureFill }) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${theme.nest}"/>
    <rect x="${x}" y="${y + 6}" width="3" height="${h - 12}" rx="1" fill="${rarity}"/>
    ${text(x + 14, y + 28, title, { size: 13, fill: theme.text, weight: 700 })}
    ${text(x + 14, y + 48, meta, { size: 12, fill: theme.muted })}
    ${text(x + 14, y + 72, figure, { size: 14, fill: figureFill, weight: 700 })}
  </g>`;
}

function rowTiles(x, y, width, height, gap, theme, items) {
  const tileWidth = (width - gap * (items.length - 1)) / items.length;
  return items
    .map((item, index) => tile(x + index * (tileWidth + gap), y, tileWidth, height, theme, item))
    .join("");
}

function panel(x, y, w, h, theme) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${theme.panel}" stroke="${theme.line}" stroke-width="1"/>`;
}

function slimRow(x, y, w, h, theme, { title, cost, delta, roi }) {
  return `<g>
    ${panel(x, y, w, h, theme)}
    <rect x="${x}" y="${y + 10}" width="3" height="${h - 20}" fill="${theme.profit}"/>
    ${text(x + 18, y + 28, title, { size: 14, fill: theme.text, weight: 700 })}
    ${text(x + 18, y + h - 16, cost, { size: 12, fill: theme.muted })}
    ${text(x + w - 18, y + 32, delta, { size: 16, fill: theme.profit, weight: 700, anchor: "end" })}
    ${text(x + w - 18, y + h - 16, roi, { size: 11, fill: theme.muted, anchor: "end" })}
  </g>`;
}

function brandedSvg(width, height) {
  const mark = height >= 500 ? 128 : 72;
  const nameSize = height >= 500 ? 64 : 56;
  const tagSize = height >= 500 ? 28 : 26;
  const markX = height >= 500 ? 64 : 56;
  const textX = height >= 500 ? 220 : 156;
  const block = nameSize + 28 + tagSize;
  const nameY = Math.round((height - block) / 2 + nameSize * 0.78);
  const tagY = nameY + 56;
  const markY = Math.round((height - mark) / 2);
  const watermark = height >= 500 ? 220 : 180;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#111110"/>
  <rect width="8" height="${height}" fill="#d7fe52"/>
  ${crosshair(markX, markY, mark, "#d7fe52")}
  ${text(textX, nameY, "TradeUpBot", { size: nameSize, fill: "#eeece7", weight: 700 })}
  ${text(textX, tagY, "CS2 trade-ups ranked by EV after fees", { size: tagSize, fill: "#918f8b" })}
  <g opacity="0.18">${crosshair(width - watermark - 40, Math.round((height - watermark) / 2), watermark, "#d7fe52")}</g>
</svg>`;
}

function desktopBody(theme) {
  const label = chip(176, 13, "Illustrative example", theme);
  const inputs = [
    ["Example rifle", "×2 · 0.1000"],
    ["Example pistol", "×2 · 0.1500"],
    ["Example smg", "×2 · 0.2000"],
    ["Example heavy", "×2 · 0.2500"],
    ["Example knife", "×2 · 0.3000"],
  ].map(([title, meta]) => ({
    rarity: CLASSIFIED,
    title,
    meta,
    figure: "$10.00",
    figureFill: theme.text,
  }));
  // 50% * 140 + 30% * 100 + 20% * 100 = 120. Profit 120 - 100 = 20. ROI 20/100.
  const outputs = [
    ["Example output A", "share 50%", "$140.00"],
    ["Example output B", "share 30%", "$100.00"],
    ["Example output C", "share 20%", "$100.00"],
  ].map(([title, meta, figure]) => ({
    rarity: theme.profit,
    title,
    meta,
    figure,
    figureFill: theme.text,
  }));
  const innerX = 36;
  const innerW = 1368;
  return `
    <rect width="1440" height="52" fill="${theme.panel}"/>
    <line x1="0" y1="52" x2="1440" y2="52" stroke="${theme.line}"/>
    ${crosshair(16, 14, 24, theme.accent)}
    ${text(50, 33, "TradeUpBot", { size: 16, fill: theme.text, weight: 700 })}
    ${label.markup}
    ${text(1288, 33, "Pricing", { size: 13, fill: theme.muted, anchor: "end" })}
    ${panel(20, 68, 1400, 376, theme)}
    ${text(36, 96, "Example trade-up", { size: 16, fill: theme.text, weight: 700 })}
    ${text(1384, 96, "Expected profit +$20.00", { size: 14, fill: theme.profit, weight: 700, anchor: "end" })}
    ${text(1384, 116, "Cost $100.00 · ROI 20%", { size: 12, fill: theme.muted, anchor: "end" })}
    ${text(36, 140, "Inputs", { size: 12, fill: theme.muted })}
    ${rowTiles(innerX, 152, innerW, 92, 10, theme, inputs)}
    ${text(36, 268, "Outputs", { size: 12, fill: theme.muted })}
    ${rowTiles(innerX, 280, innerW, 92, 10, theme, outputs)}
    ${text(36, 400, "Cost $100.00", { size: 13, fill: theme.text, weight: 700 })}
    ${text(150, 400, "Expected profit +$20.00", { size: 13, fill: theme.profit, weight: 700 })}
    ${text(360, 400, "ROI 20%", { size: 13, fill: theme.profit, weight: 700 })}
    ${text(36, 422, "Sample round numbers. Not a live result.", { size: 12, fill: theme.muted })}
    ${slimRow(20, 460, 1400, 78, theme, { title: "Example trade-up", cost: "10 × $10.00 · float 0.2000", delta: "+$10.00", roi: "ROI 10%" })}
    ${slimRow(20, 550, 1400, 78, theme, { title: "Example trade-up", cost: "10 × $10.00 · float 0.2000", delta: "+$10.00", roi: "ROI 10%" })}
    ${slimRow(20, 640, 1400, 78, theme, { title: "Example trade-up", cost: "10 × $10.00 · float 0.2000", delta: "+$20.00", roi: "ROI 20%" })}
    ${slimRow(20, 730, 1400, 78, theme, { title: "Example trade-up", cost: "10 × $10.00 · float 0.2000", delta: "+$10.00", roi: "ROI 10%" })}
  `;
}

function mobileBody(theme) {
  const label = chip(16, 60, "Illustrative example", theme);
  const inputs = [
    ["Example rifle", "×5 · 0.1500"],
    ["Example pistol", "×5 · 0.2500"],
  ].map(([title, meta]) => ({
    rarity: CLASSIFIED,
    title,
    meta,
    figure: "$10.00",
    figureFill: theme.text,
  }));
  // 50% * 140 + 50% * 100 = 120. Profit 120 - 100 = 20. ROI 20/100.
  const outputs = [
    ["Example output A", "share 50%", "$140.00"],
    ["Example output B", "share 50%", "$100.00"],
  ].map(([title, meta, figure]) => ({
    rarity: theme.profit,
    title,
    meta,
    figure,
    figureFill: theme.text,
  }));
  return `
    <rect width="390" height="48" fill="${theme.panel}"/>
    <line x1="0" y1="48" x2="390" y2="48" stroke="${theme.line}"/>
    ${crosshair(12, 12, 24, theme.accent)}
    ${text(44, 31, "TradeUpBot", { size: 15, fill: theme.text, weight: 700 })}
    ${label.markup}
    ${panel(12, 100, 366, 392, theme)}
    ${text(26, 128, "Example trade-up", { size: 15, fill: theme.text, weight: 700 })}
    ${text(26, 150, "Cost $100.00 · ROI 20%", { size: 12, fill: theme.muted })}
    ${text(362, 128, "+$20.00", { size: 15, fill: theme.profit, weight: 700, anchor: "end" })}
    ${text(26, 176, "Inputs", { size: 12, fill: theme.muted })}
    ${rowTiles(26, 188, 338, 96, 8, theme, inputs)}
    ${text(26, 308, "Outputs", { size: 12, fill: theme.muted })}
    ${rowTiles(26, 320, 338, 96, 8, theme, outputs)}
    ${text(26, 444, "Expected profit +$20.00", { size: 13, fill: theme.profit, weight: 700 })}
    ${text(26, 466, "Sample round numbers. Not a live result.", { size: 11, fill: theme.muted })}
    ${slimRow(12, 508, 366, 72, theme, { title: "Example trade-up", cost: "10 × $10.00", delta: "+$10.00", roi: "ROI 10%" })}
    ${slimRow(12, 592, 366, 72, theme, { title: "Example trade-up", cost: "10 × $10.00", delta: "+$10.00", roi: "ROI 10%" })}
    ${slimRow(12, 676, 366, 72, theme, { title: "Example trade-up", cost: "10 × $10.00", delta: "+$20.00", roi: "ROI 20%" })}
  `;
}

function framed(width, height, viewWidth, viewHeight, bg, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewWidth} ${viewHeight}">
  <rect width="${viewWidth}" height="${viewHeight}" fill="${bg}"/>
  ${body}
</svg>`;
}

function renderSvg(svg) {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [
        path.join(fontDir, "Inter-Regular.ttf"),
        path.join(fontDir, "Inter-Bold.ttf"),
      ],
      defaultFontFamily: "Inter",
      loadSystemFonts: false,
    },
    textRendering: 1,
    shapeRendering: 2,
    fitTo: { mode: "original" },
  });
  return resvg.render().asPng();
}

async function writeRaster(svg, dest, kind) {
  const png = renderSvg(svg);
  const image = sharp(png);
  const meta = await image.metadata();
  if (kind === "jpeg") {
    await image.jpeg({ quality: 90, mozjpeg: true }).toFile(dest);
  } else {
    await image.webp({ quality: 90 }).toFile(dest);
  }
  const out = await sharp(dest).metadata();
  if (out.width !== meta.width || out.height !== meta.height) {
    throw new Error(`${dest} size changed during encode`);
  }
  return { width: out.width, height: out.height };
}

const boards = [
  ["board-desktop-dark", 2880, 1872, 1440, 936, "dark", desktopBody],
  ["board-desktop-light", 2880, 1872, 1440, 936, "light", desktopBody],
  ["board-mobile-dark", 780, 1688, 390, 844, "dark", mobileBody],
  ["board-mobile-light", 780, 1688, 390, 844, "light", mobileBody],
];

mkdirSync(artDir, { recursive: true });
mkdirSync(path.join(publicDir, "preview"), { recursive: true });

const og = brandedSvg(1200, 630);
writeFileSync(path.join(artDir, "og-default.svg"), og);
const ogSize = await writeRaster(og, path.join(publicDir, "og-default.jpg"), "jpeg");
if (ogSize.width !== 1200 || ogSize.height !== 630) {
  throw new Error(`og-default.jpg is ${ogSize.width}x${ogSize.height}, expected 1200x630`);
}
console.log("og-default.jpg", ogSize.width, ogSize.height);

const banner = brandedSvg(1200, 356);
writeFileSync(path.join(artDir, "pricing-banner.svg"), banner);
const bannerSize = await writeRaster(banner, path.join(publicDir, "pricing-banner.jpg"), "jpeg");
if (bannerSize.width !== 1200 || bannerSize.height !== 356) {
  throw new Error(`pricing-banner.jpg is ${bannerSize.width}x${bannerSize.height}, expected 1200x356`);
}
console.log("pricing-banner.jpg", bannerSize.width, bannerSize.height);

for (const [name, width, height, viewWidth, viewHeight, mode, body] of boards) {
  const theme = themes[mode];
  const svg = framed(width, height, viewWidth, viewHeight, theme.bg, body(theme));
  writeFileSync(path.join(artDir, `${name}.svg`), svg);
  const size = await writeRaster(svg, path.join(publicDir, "preview", `${name}.webp`), "webp");
  if (size.width !== width || size.height !== height) {
    throw new Error(`${name}.webp is ${size.width}x${size.height}, expected ${width}x${height}`);
  }
  console.log(`${name}.webp`, size.width, size.height);
}
