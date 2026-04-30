import { describe, it, expect } from "vitest";
import { listingUrl } from "../../src/utils/format.js";

describe("listingUrl dmarket StatTrak filter", () => {
  it("uses stattrak filter for StatTrak listings", () => {
    const url = listingUrl(
      "dmarket:test",
      "StatTrak™ Glock-18 | Winterized",
      "Field-Tested",
      0.2819,
      1234,
      "dmarket",
      undefined,
      true,
    );

    expect(url).toContain("category_0=stattrak_tm");
    expect(url).toContain("floatValueFrom=0.281");
    expect(url).toContain("floatValueTo=0.282");
  });

  it("keeps non-StatTrak filter for normal listings", () => {
    const url = listingUrl(
      "dmarket:test",
      "Glock-18 | Winterized",
      "Field-Tested",
      0.2819,
      1234,
      "dmarket",
      undefined,
      false,
    );

    expect(url).toContain("category_0=not_stattrak_tm");
  });
});
