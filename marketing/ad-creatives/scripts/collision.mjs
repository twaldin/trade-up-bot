import { bundle } from "@remotion/bundler";
import { selectComposition } from "@remotion/renderer";
import { chromium } from "playwright";
import { NoReactInternals } from "remotion/no-react";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ids = [
  "static-float-boundary-1080",
  "static-float-boundary-1350",
  "static-float-boundary-1920",
  "static-float-number-1080",
  "static-float-number-1350",
  "static-verify-1080",
  "static-verify-1350",
  "static-fees-1080",
  "static-fees-1350",
  "meta-a-float-vertical",
  "meta-a-float-square",
  "meta-a-float-portrait",
  "meta-b-screen-vertical",
  "meta-c-verify-vertical",
];

const safe = (width, height) => {
  if (height === 1920) return { top: 270, bottom: 1920 - 672, left: 36, right: width - 36 };
  const inset = 48;
  return { top: inset, bottom: height - inset, left: inset, right: width - inset };
};

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const serve = (dir) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      let file = path.join(dir, url);
      if (url.endsWith("/")) file = path.join(file, "index.html");
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });

const measure = () => {
  const boxes = [];
  const visuals = [...document.querySelectorAll("[data-visual]")];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let nodeId = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodeId += 1;
    if (!node.textContent || !node.textContent.trim()) continue;
    const owners = [];
    let el = node.parentElement;
    while (el) {
      const vi = visuals.indexOf(el);
      if (vi >= 0) owners.push(vi);
      el = el.parentElement;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      boxes.push({
        id: nodeId,
        owners,
        t: node.textContent.trim().slice(0, 48),
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        r: rect.right,
        b: rect.bottom,
      });
    }
  }
  visuals.forEach((el, vi) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const parents = [];
    let parent = el.parentElement;
    while (parent) {
      const pi = visuals.indexOf(parent);
      if (pi >= 0) parents.push(pi);
      parent = parent.parentElement;
    }
    boxes.push({
      id: -(vi + 1),
      owners: parents,
      t: el.getAttribute("data-visual") || "visual",
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      r: rect.right,
      b: rect.bottom,
    });
  });
  const clipped = [];
  for (const box of boxes) {
    let el = document.elementFromPoint(box.x + box.w / 2, box.y + Math.min(box.h / 2, 4));
    while (el) {
      const style = getComputedStyle(el);
      if (style.overflowX === "hidden" || style.overflowY === "hidden" || style.overflow === "hidden") {
        const host = el.getBoundingClientRect();
        const cut = box.y < host.top - 1 || box.b > host.bottom + 1 || box.x < host.left - 1 || box.r > host.right + 1;
        if (cut) clipped.push(box.t);
      }
      el = el.parentElement;
    }
  }
  return { boxes, clipped };
};

const area = (a, b) => {
  const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
  const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const bundled = await bundle({
  entryPoint: path.join(root, "src/index.tsx"),
  publicDir: path.join(root, "public"),
});
const { server, port } = await serve(bundled);
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const id of ids) {
    const composition = await selectComposition({ serveUrl: bundled, id });
    const page = await browser.newPage({ viewport: { width: composition.width, height: composition.height }, deviceScaleFactor: 1 });
    const serialized = NoReactInternals.serializeJSONWithSpecialTypes({
      indent: undefined,
      staticBase: null,
      data: composition.props,
    }).serializedString;
    const frames =
      composition.durationInFrames === 1
        ? [0]
        : [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => Math.min(composition.durationInFrames - 1, Math.round(p * composition.durationInFrames)));
    await page.goto(origin, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.remotion_setBundleMode === "function", { timeout: 60000 });
    await page.evaluate(
      (payload) => {
        window.remotion_setBundleMode({
          type: "composition",
          compositionName: payload.id,
          serializedResolvedPropsWithSchema: payload.serialized,
          compositionDurationInFrames: payload.durationInFrames,
          compositionFps: payload.fps,
          compositionHeight: payload.height,
          compositionWidth: payload.width,
          compositionDefaultCodec: payload.defaultCodec,
          compositionDefaultOutName: payload.defaultOutName,
          compositionDefaultVideoImageFormat: payload.defaultVideoImageFormat,
          compositionDefaultPixelFormat: payload.defaultPixelFormat,
          compositionDefaultProResProfile: payload.defaultProResProfile,
          compositionDefaultSampleRate: payload.defaultSampleRate,
        });
      },
      { ...composition, id, serialized },
    );
    const band = safe(composition.width, composition.height);
    for (const frame of frames) {
      await page.evaluate(({ f, c }) => window.remotion_setFrame(f, c, 0), { f: frame, c: id });
      await page.waitForFunction(() => window.remotion_renderReady === true, { timeout: 60000 });
      const { boxes, clipped } = await page.evaluate(measure);
      const hits = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].id === boxes[j].id) continue;
          if (boxes[i].id < 0 || boxes[j].id < 0) {
            const host = boxes[i].id < 0 ? boxes[i] : boxes[j];
            const ink = boxes[i].id < 0 ? boxes[j] : boxes[i];
            const hostIndex = -host.id - 1;
            if (ink.owners && ink.owners.includes(hostIndex)) continue;
          }
          const overlap = area(boxes[i], boxes[j]);
          const iw = Math.min(boxes[i].r, boxes[j].r) - Math.max(boxes[i].x, boxes[j].x);
          const ih = Math.min(boxes[i].b, boxes[j].b) - Math.max(boxes[i].y, boxes[j].y);
          if (overlap > 1 && iw > 1 && ih > 1) hits.push(`overlap ${overlap.toFixed(0)}px ih ${ih.toFixed(1)} "${boxes[i].t}" y${boxes[i].y.toFixed(0)} × "${boxes[j].t}" y${boxes[j].y.toFixed(0)}`);
        }
        const box = boxes[i];
        if (box.y < band.top - 1 || box.b > band.bottom + 1 || box.x < band.left - 1 || box.r > band.right + 1) {
          hits.push(`outside safe zone "${box.t}" y ${box.y.toFixed(0)}-${box.b.toFixed(0)}`);
        }
      }
      for (const text of clipped) hits.push(`clipped "${text}"`);
      if (composition.durationInFrames === 1 && boxes.length) {
        const limit = composition.height * 0.15;
        const spans = boxes
          .map((b) => [Math.max(band.top, b.y), Math.min(band.bottom, b.b)])
          .sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const span of spans) {
          const last = merged[merged.length - 1];
          if (!last || span[0] > last[1]) merged.push([...span]);
          else last[1] = Math.max(last[1], span[1]);
        }
        const gaps = [merged[0][0] - band.top];
        for (let i = 1; i < merged.length; i++) gaps.push(merged[i][0] - merged[i - 1][1]);
        gaps.push(band.bottom - merged[merged.length - 1][1]);
        const worst = Math.max(...gaps);
        if (worst > limit) hits.push(`empty band ${worst.toFixed(0)}px exceeds 15% (${limit.toFixed(0)}px)`);
      }
      if (hits.length) {
        failures.push(`${id} frame ${frame}: ${hits.slice(0, 8).join("; ")}`);
        console.log(`FAIL ${id} frame ${frame} (${hits.length})`);
        for (const hit of hits.slice(0, 6)) console.log(`  ${hit}`);
      } else {
        console.log(`ok ${id} frame ${frame} (${boxes.length} text boxes)`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.log(`collision failed (${failures.length})`);
  process.exit(1);
}
console.log("collision ok");
