import { describe, expect, it } from "vitest";
import { facesFromRows, parseFaceNames } from "../../server/routes/preview-faces.js";

describe("preview faces lookup", () => {
  it("parses pipe-delimited names and caps the batch", () => {
    expect(parseFaceNames("AK-47 | Redline||AWP | Asiimov")).toEqual([
      "AK-47 | Redline",
      "AWP | Asiimov",
    ]);
    expect(parseFaceNames("")).toEqual([]);
    const many = Array.from({ length: 120 }, (_, i) => `Skin ${i}`).join("||");
    expect(parseFaceNames(many)).toHaveLength(80);
  });

  it("maps stored image_url without inventing catalog fetches", () => {
    expect(facesFromRows([
      { name: "AK-47 | Redline", image_url: "https://community.fastly.steamstatic.com/economy/image/abc" },
      { name: "Ghost", image_url: null },
    ])).toEqual({
      "AK-47 | Redline": "https://community.fastly.steamstatic.com/economy/image/abc",
      Ghost: null,
    });
  });
});
