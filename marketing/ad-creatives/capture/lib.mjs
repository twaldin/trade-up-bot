import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Policy: chance / odds figures must stay out of focus in ad footage.
 * This overlay draws backdrop-blur boxes over them without touching the
 * site's own DOM (so React keeps rendering normally underneath).
 */
export const BLUR_INIT_SCRIPT = `(() => {
  const TEXT_RE = /chance|odds|\\brolls?\\b|P\\(P\\/L|probability of clearing|break-even or better/i;
  const PANEL_SEL = [".preview-skin--output .preview-skin__trail", ".preview-rank__odds", ".preview-cardline"];
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "OPTION", "TITLE", "TEXTAREA"]);
  let targets = [];
  let layer;
  const pool = [];

  function scan() {
    const next = [];
    const seen = new Set();
    const addEl = (el) => { if (el && !seen.has(el)) { seen.add(el); next.push({ el }); } };
    for (const sel of PANEL_SEL) document.querySelectorAll(sel).forEach(addEl);
    document.querySelectorAll(".preview-cdf").forEach((el) => addEl(el.closest(".preview-subpanel") || el.closest("figure") || el));
    document.querySelectorAll(".preview-readout").forEach((el) => { if (TEXT_RE.test(el.querySelector("em")?.textContent || "")) addEl(el); });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (!p || SKIP.has(p.tagName) || p.closest("[data-blur-layer]")) continue;
      const t = n.textContent || "";
      if (!t.trim()) continue;
      if (TEXT_RE.test(t)) {
        let inside = false;
        for (const s of seen) if (s.contains && s.contains(p)) { inside = true; break; }
        if (!inside) next.push({ node: n });
      }
    }
    targets = next;
  }

  function rectsFor(t) {
    if (t.el) return [t.el.getBoundingClientRect()];
    const r = document.createRange();
    r.selectNodeContents(t.node);
    return [...r.getClientRects()];
  }

  function frame() {
    if (!layer) {
      layer = document.createElement("div");
      layer.setAttribute("data-blur-layer", "");
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
      document.documentElement.appendChild(layer);
    }
    let i = 0;
    for (const t of targets) {
      for (const r of rectsFor(t)) {
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
        let b = pool[i];
        if (!b) {
          b = document.createElement("div");
          b.style.cssText = "position:fixed;border-radius:3px;background:#1c1b19;";
          layer.appendChild(b);
          pool.push(b);
        }
        b.style.display = "block";
        b.style.left = r.left - 3 + "px";
        b.style.top = r.top - 2 + "px";
        b.style.width = r.width + 6 + "px";
        b.style.height = r.height + 4 + "px";
        i++;
      }
    }
    for (; i < pool.length; i++) pool[i].style.display = "none";
    requestAnimationFrame(frame);
  }

  function start() {
    scan();
    setInterval(scan, 200);
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;

/**
 * Records a page with the CDP screencast (JPEG frames with real timestamps),
 * then assembles a constant-30fps H.264 MP4. Events (moves, clicks, taps,
 * markers) are logged in seconds relative to the first frame.
 */
export async function startRecording(page, { id, outDir, maxWidth, maxHeight }) {
  const client = await page.context().newCDPSession(page);
  const frameDir = path.join(outDir, `.frames-${id}`);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const frames = [];
  let first = null;
  client.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(frameDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    if (first === null) first = metadata.timestamp;
    frames.push({ file, t: metadata.timestamp });
    await client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth, maxHeight, everyNthFrame: 1 });
  const events = [];
  const markers = {};
  const rects = {};
  const now = () => (first === null ? 0 : Date.now() / 1000 - first);

  return {
    events,
    markers,
    rects,
    now,
    /** Logs an element's viewport rect (CSS px) so the edit can frame it without hand-tuned coordinates. */
    async rect(name, locator) {
      const b = await locator.boundingBox().catch(() => null);
      if (b) rects[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), t: +now().toFixed(3) };
    },
    log(ev) { events.push({ ...ev, t: +now().toFixed(3) }); },
    mark(name) { markers[name] = +now().toFixed(3); },
    async stop() {
      const stopAt = Date.now() / 1000;
      await client.send("Page.stopScreencast").catch(() => {});
      await sleep(300);
      await client.detach().catch(() => {});
      if (frames.length === 0) throw new Error(`no frames recorded for ${id}`);
      const list = frames
        .map((f, i) => {
          const next = i + 1 < frames.length ? frames[i + 1].t : stopAt;
          return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
        })
        .join("\n");
      const listFile = path.join(frameDir, "list.txt");
      fs.writeFileSync(listFile, `${list}\nfile '${frames[frames.length - 1].file}'\n`);
      const mp4 = path.join(outDir, `${id}.mp4`);
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "medium",
        "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
      ]);
      const probe = execFileSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
        "-of", "json", mp4,
      ]).toString();
      const info = JSON.parse(probe);
      fs.rmSync(frameDir, { recursive: true, force: true });
      return {
        file: path.basename(mp4),
        width: info.streams[0].width,
        height: info.streams[0].height,
        duration: +(+info.format.duration).toFixed(3),
        frames: frames.length,
      };
    },
  };
}

/** Desktop pointer helper: real mouse moves (so hover states render) + logged path for the overlay cursor. */
export async function moveMouse(page, rec, state, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 16));
  rec.log({ type: "move-start", x: state.x, y: state.y });
  await page.mouse.move(x, y, { steps });
  rec.log({ type: "move-end", x, y });
  state.x = x;
  state.y = y;
}

export async function centerOf(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

// The console scrolls an inner container, not the window: find whichever
// element actually scrolls under the viewport centre.
const SCROLLER = `(() => {
  let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) return el;
    el = el.parentElement;
  }
  return document.scrollingElement;
})()`;

export async function smoothScrollTo(page, locatorOrY, block = "center", settle = 1400) {
  if (typeof locatorOrY === "number") {
    await page.evaluate(([y, sc]) => (0, eval)(sc).scrollTo({ top: y, behavior: "smooth" }), [locatorOrY, SCROLLER]);
  } else {
    await locatorOrY.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
  }
  await sleep(settle);
}

export async function smoothScrollBy(page, dy, settle = 1200) {
  await page.evaluate(([y, sc]) => (0, eval)(sc).scrollBy({ top: y, behavior: "smooth" }), [dy, SCROLLER]);
  await sleep(settle);
}

export async function scrollTopInstant(page) {
  await page.evaluate((sc) => {
    window.scrollTo(0, 0);
    (0, eval)(sc).scrollTo({ top: 0, behavior: "instant" });
  }, SCROLLER);
}
