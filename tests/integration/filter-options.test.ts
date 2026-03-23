import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

interface SkinOption {
  name: string;
  input: boolean;
  output: boolean;
}

interface CollectionOption {
  name: string;
  count: string;
}

describe("/api/filter-options", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns input skins", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    expect(res.status).toBe(200);
    const skinNames = res.body.skins.map((s: SkinOption) => s.name);
    expect(skinNames).toContain("AK-47 | Test Skin");
  });

  it("returns output skins from outcomes_json", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    const skinNames = res.body.skins.map((s: SkinOption) => s.name);
    // AK-47 | Fire Serpent is an outcome in seed data, not an input
    expect(skinNames).toContain("AK-47 | Fire Serpent");
  });

  it("marks skins with correct input/output flags", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    const testSkin = res.body.skins.find((s: SkinOption) => s.name === "AK-47 | Test Skin");
    expect(testSkin.input).toBe(true);
    // AK-47 | Test Skin is only an input
    const fireSerpent = res.body.skins.find((s: SkinOption) => s.name === "AK-47 | Fire Serpent");
    expect(fireSerpent.output).toBe(true);
  });

  it("returns collections with counts", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    expect(res.body.collections.length).toBeGreaterThan(0);
    const alpha = res.body.collections.find((c: CollectionOption) => c.name === "Test Collection Alpha");
    expect(alpha).toBeDefined();
    expect(Number(alpha.count)).toBeGreaterThan(0);
  });
});
