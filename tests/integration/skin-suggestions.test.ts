import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createExpandedApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/skin-suggestions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("returns empty for query under 2 chars", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=A");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it("matches by partial name", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=Test+Skin");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].name).toContain("Test Skin");
  });

  it("matches knives without star character", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=bayonet");
    expect(res.status).toBe(200);
    const names = res.body.results.map((r: { name: string }) => r.name);
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
  });

  it("matches knives without pipe character", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=bayonet+fade");
    expect(res.status).toBe(200);
    const names = res.body.results.map((r: { name: string }) => r.name);
    expect(names).toContain("★ Bayonet | Fade");
  });

  it("returns at most 15 results", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=Skin");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(15);
  });

  it("includes collection_name for regular skins", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=AK-47+Test");
    expect(res.status).toBe(200);
    const ak = res.body.results.find((r: { name: string }) => r.name === "AK-47 | Test Skin");
    expect(ak).toBeDefined();
    expect(ak.collection_name).toContain("Test Collection Alpha");
  });

  it("sorts by rarity rank descending (Covert first)", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=AK");
    expect(res.status).toBe(200);
    if (res.body.results.length >= 2) {
      const rarityOrder = ["Consumer Grade", "Industrial Grade", "Mil-Spec", "Restricted", "Classified", "Covert", "Extraordinary"];
      const firstRank = rarityOrder.indexOf(res.body.results[0].rarity);
      const lastRank = rarityOrder.indexOf(res.body.results[res.body.results.length - 1].rarity);
      expect(firstRank).toBeGreaterThanOrEqual(lastRank);
    }
  });
});
