import { describe, it, expect } from "vitest";
import { sanitizeRef, steamAuthUrl, REF_PATTERN } from "../../shared/ref.js";

describe("sanitizeRef", () => {
  it("accepts valid alphanumeric/_/- codes", () => {
    expect(sanitizeRef("creator123")).toBe("creator123");
    expect(sanitizeRef("yt_launch-2026")).toBe("yt_launch-2026");
  });

  it("rejects empty, non-string, and over-length values", () => {
    expect(sanitizeRef("")).toBeNull();
    expect(sanitizeRef(undefined)).toBeNull();
    expect(sanitizeRef(null)).toBeNull();
    expect(sanitizeRef(123)).toBeNull();
    expect(sanitizeRef(["a", "b"])).toBeNull();
    expect(sanitizeRef("x".repeat(65))).toBeNull();
  });

  it("rejects codes with unsafe characters (injection / path / query)", () => {
    expect(sanitizeRef("a b")).toBeNull();
    expect(sanitizeRef("a/b")).toBeNull();
    expect(sanitizeRef("a&b=c")).toBeNull();
    expect(sanitizeRef("<script>")).toBeNull();
  });

  it("REF_PATTERN is anchored", () => {
    expect(REF_PATTERN.test("good")).toBe(true);
    expect(REF_PATTERN.test("bad ref")).toBe(false);
  });
});

describe("steamAuthUrl", () => {
  it("returns bare path with no args", () => {
    expect(steamAuthUrl()).toBe("/auth/steam");
  });

  it("includes a return path", () => {
    expect(steamAuthUrl("/dashboard")).toBe("/auth/steam?return=%2Fdashboard");
  });

  it("appends a valid ref", () => {
    expect(steamAuthUrl("/calculator", "creator1")).toBe(
      "/auth/steam?return=%2Fcalculator&ref=creator1"
    );
  });

  it("drops an invalid ref but keeps return", () => {
    expect(steamAuthUrl("/x", "bad ref")).toBe("/auth/steam?return=%2Fx");
  });

  it("appends ref alone when no return", () => {
    expect(steamAuthUrl(undefined, "creator1")).toBe("/auth/steam?ref=creator1");
  });
});
