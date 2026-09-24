import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "out");
fs.mkdirSync(outDir, { recursive: true });
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

const bundled = await bundle({ entryPoint: path.join(root, "src/index.tsx"), publicDir: path.join(root, "public") });
const ids = [
  "meta-a-float-vertical",
  "meta-a-float-square",
  "meta-a-float-portrait",
  "meta-b-screen-vertical",
  "meta-c-verify-vertical",
  "static-float-boundary-1080",
  "static-float-boundary-1350",
  "static-float-boundary-1920",
  "static-float-number-1080",
  "static-float-number-1350",
  "static-verify-1080",
  "static-verify-1350",
  "static-fees-1080",
  "static-fees-1350",
].filter((id) => {
  if (!only || only === "all") return true;
  if (only === "videos") return id.startsWith("meta-");
  if (only === "stills") return id.startsWith("static-");
  return only.split(",").includes(id);
});

for (const id of ids) {
  const composition = await selectComposition({ serveUrl: bundled, id });
  const file = path.join(outDir, composition.durationInFrames === 1 ? `${id}.png` : `${id}.mp4`);
  console.log(`render ${id} ${composition.width}x${composition.height} ${composition.durationInFrames}f`);
  if (composition.durationInFrames === 1) {
    await renderStill({ composition, serveUrl: bundled, output: file, imageFormat: "png" });
  } else {
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: "h264",
      outputLocation: file,
      crf: 23,
      imageFormat: "jpeg",
      jpegQuality: 85,
    });
  }
  const size = fs.statSync(file).size;
  console.log(`  ${file} ${(size / 1e6).toFixed(1)} MB`);
  if (file.endsWith(".mp4") && size > 15_000_000) console.log("  WARNING over 15 MB");
}
