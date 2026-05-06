#!/usr/bin/env node
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const RESPONSIVE_TARGETS = ["collections", "expanded", "dataviewer"];
const WIDTHS = [375, 768, 1280];
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;
const OG_IMAGE = "tradeuptable.jpg";
const OG_MAX_BYTES = 150 * 1024;
const OG_TARGET_WIDTH = 1200;

function fmt(bytes) {
  return (bytes / 1024).toFixed(1) + " KB";
}

async function buildResponsive(name) {
  const src = path.join(PUBLIC_DIR, `${name}.jpg`);
  const meta = await sharp(src).metadata();
  const srcSize = (await stat(src)).size;
  console.log(`\n${name}.jpg  ${meta.width}x${meta.height}  ${fmt(srcSize)}`);
  for (const w of WIDTHS) {
    const jpgOut = path.join(PUBLIC_DIR, `${name}-${w}w.jpg`);
    const webpOut = path.join(PUBLIC_DIR, `${name}-${w}w.webp`);
    await sharp(src)
      .resize({ width: w, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(jpgOut);
    await sharp(src)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(webpOut);
    const jpgSize = (await stat(jpgOut)).size;
    const webpSize = (await stat(webpOut)).size;
    console.log(`  ${w}w  jpg=${fmt(jpgSize).padStart(9)}  webp=${fmt(webpSize).padStart(9)}`);
  }
}

async function shrinkOg() {
  const src = path.join(PUBLIC_DIR, OG_IMAGE);
  const before = (await stat(src)).size;
  const meta = await sharp(src).metadata();
  console.log(`\n${OG_IMAGE}  ${meta.width}x${meta.height}  ${fmt(before)} (before)`);
  const tmp = src + ".tmp";
  for (const quality of [85, 78, 70, 60]) {
    await sharp(src)
      .resize({ width: OG_TARGET_WIDTH, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(tmp);
    const size = (await stat(tmp)).size;
    if (size <= OG_MAX_BYTES || quality === 60) {
      const { rename } = await import("node:fs/promises");
      await rename(tmp, src);
      const finalMeta = await sharp(src).metadata();
      console.log(`  q=${quality}  ${finalMeta.width}x${finalMeta.height}  ${fmt(size)} (after)`);
      return;
    }
  }
}

async function main() {
  for (const name of RESPONSIVE_TARGETS) {
    await buildResponsive(name);
  }
  await shrinkOg();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
