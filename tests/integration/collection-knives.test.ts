import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createExpandedApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/skin-data collection knife/glove display", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("all tab includes regular skins from collection", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    expect(res.status).toBe(200);
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names).toContain("AK-47 | Test Skin");
  });

  it("all tab includes knife skins from collection's case pool", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
    expect(names.some((n: string) => n.includes("Flip Knife"))).toBe(true);
  });

  it("all tab does NOT include knives from other collections", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names.some((n: string) => n.includes("Karambit"))).toBe(false);
  });

  it("all tab sorts knives first", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names: string[] = res.body.map((s: { name: string }) => s.name);
    const firstKnifeIdx = names.findIndex(n => n.startsWith("★"));
    const lastKnifeIdx = names.length - 1 - [...names].reverse().findIndex(n => n.startsWith("★"));
    const firstRegularIdx = names.findIndex(n => !n.startsWith("★"));
    if (firstKnifeIdx !== -1 && firstRegularIdx !== -1) {
      expect(lastKnifeIdx).toBeLessThan(firstRegularIdx);
    }
  });

  it("outputCollection returns only collection-specific knives", async () => {
    const res = await request(ctx.app).get("/api/skin-data?outputCollection=Test+Collection+Alpha");
    expect(res.status).toBe(200);
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
    expect(names.some((n: string) => n.includes("Karambit"))).toBe(false);
  });

  it("outputCollection for unknown collection returns empty", async () => {
    const res = await request(ctx.app).get("/api/skin-data?outputCollection=NonExistent+Collection");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("collection without knives shows no knives in all tab", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Beta&limit=200");
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names.every((n: string) => !n.startsWith("★"))).toBe(true);
  });
});
