import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import sharp from "sharp";
import { makeTradeUp } from "../helpers/fixtures.js";

const readFileSync = fs.readFileSync.bind(fs);
const payload = {
  ...makeTradeUp(),
  type: "classified_covert",
  chance_to_profit: 0.5,
  best_case_cents: 1000,
  worst_case_cents: -1000,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it("renders the same pixels when font buffers have unrelated surrounding bytes", async () => {
  let padded = false;
  vi.spyOn(fs, "readFileSync").mockImplementation((file, options) => {
    const bytes = readFileSync(file, options);
    if (!String(file).endsWith(".ttf") || !Buffer.isBuffer(bytes)) return bytes;
    const storage = Buffer.alloc(bytes.length + (padded ? 32 : 0), 0x78);
    bytes.copy(storage, padded ? 16 : 0);
    return padded ? storage.subarray(16, 16 + bytes.length) : storage;
  });
  // Dynamic imports reload the startup font cache for each buffer layout.
  const baseline = await import("../../server/og-image.js");
  const expected = await sharp(await baseline.generateOgImage(payload)).raw().toBuffer();
  padded = true;
  vi.resetModules();
  const candidate = await import("../../server/og-image.js");
  const actual = await sharp(await candidate.generateOgImage(payload)).raw().toBuffer();
  expect(actual.equals(expected)).toBe(true);
});

it("renders heavier branding with the bold font than with the regular font", async () => {
  // Reloading the renderer lets the comparison substitute only the bold font data.
  const baseline = await import("../../server/og-image.js");
  const bold = await baseline.generateOgImage(payload);
  vi.spyOn(fs, "readFileSync").mockImplementation((file, options) => {
    const source = String(file).endsWith("Inter-Bold.ttf")
      ? new URL("../../server/fonts/Inter-Regular.ttf", import.meta.url)
      : file;
    return readFileSync(source, options);
  });
  vi.resetModules();
  const candidate = await import("../../server/og-image.js");
  const regular = await candidate.generateOgImage(payload);
  const branding = { left: 52, top: 40, width: 200, height: 50 };
  const boldPixels = await sharp(bold).extract(branding).removeAlpha().raw().toBuffer();
  const regularPixels = await sharp(regular).extract(branding).removeAlpha().raw().toBuffer();
  const lightPixels = (pixels: Buffer) => {
    let count = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) count++;
    }
    return count;
  };
  expect(lightPixels(boldPixels)).toBeGreaterThan(lightPixels(regularPixels));
});
