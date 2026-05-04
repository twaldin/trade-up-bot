import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

describe("H1 on listing pages (#9)", () => {
  it("/trade-ups crawler bodyHtml uses <h1> not <h2> as first heading", () => {
    const source = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
    // The /trade-ups handler bodyHtml must start with <h1>, not <h2>
    // Check the specific string used in the trade-ups handler
    expect(source).toContain("<h1>Find Profitable CS2 Trade-Up Contracts</h1>");
    expect(source).not.toContain("<h2>Find Profitable CS2 Trade-Up Contracts</h2>");
  });

  it("/skins crawler bodyHtml contains an <h1>", () => {
    const source = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
    // The /skins handler must include an H1 in its bodyHtml (not just bodyText)
    // We look for an h1 tag associated with the skins route context
    // The skins route bodyHtml should include <h1>CS2 Skin...
    const skinsRouteMatch = source.match(/app\.get\("\/skins"[\s\S]{0,3000}?(?=app\.get)/);
    expect(skinsRouteMatch, "could not find /skins route in server/index.ts").toBeTruthy();
    expect(skinsRouteMatch![0]).toContain("<h1>");
  });
});
