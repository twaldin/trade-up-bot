import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerRobotsTxtRoute } from "../../server/routes/sitemap.js";

describe("GET /robots.txt", () => {
  it("serves canonical robots directives from an Express route", async () => {
    const app = express();
    registerRobotsTxtRoute(app);

    const response = await request(app).get("/robots.txt").expect(200);

    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.text).toContain("Disallow: /auth/");
    expect(response.text).toContain("Disallow: /api/");
    expect(response.text).toContain("Sitemap: https://tradeupbot.app/sitemap.xml");
  });
});
