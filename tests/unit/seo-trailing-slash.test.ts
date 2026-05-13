import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { registerBlogRoutes } from "../../server/blog-routes.js";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";

describe("blog post canonical uses trailing slash (#2)", () => {
  const knownSlug = "how-cs2-trade-ups-work";

  function createApp() {
    const app = express();
    registerBlogRoutes(app, "<!doctype html><html><head><title></title></head><body><div id=\"root\"></div></body></html>");
    return app;
  }

  it("redirects known blog post URLs without a trailing slash to the canonical trailing-slash route", async () => {
    const response = await request(createApp())
      .get(`/blog/${knownSlug}`)
      .expect(301);

    expect(response.headers.location).toBe(`/blog/${knownSlug}/`);
  });

  it("serves known trailing-slash blog post URLs with crawler HTML and a self-referencing canonical", async () => {
    const response = await request(createApp())
      .get(`/blog/${knownSlug}/`)
      .set("User-Agent", "Googlebot")
      .expect(200)
      .expect("Content-Type", /html/);

    expect(response.text).toContain(`<link rel="canonical" href="https://tradeupbot.app/blog/${knownSlug}/" />`);
    expect(response.text).toContain("<article>");
  });

  it("keeps blog crawler canonical URLs identical to sitemap URLs", async () => {
    const response = await request(createApp())
      .get(`/blog/${knownSlug}/`)
      .set("User-Agent", "Googlebot")
      .expect(200);

    const canonical = response.text.match(/<link rel="canonical" href="([^"]+)" \/>/)?.[1];
    const sitemap = buildStaticSitemap("https://tradeupbot.app", "2026-05-13");

    expect(canonical).toBe(`https://tradeupbot.app/blog/${knownSlug}/`);
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  });

  it("returns 404 for unknown blog slugs with or without trailing slash", async () => {
    const app = createApp();

    await request(app)
      .get("/blog/this-post-does-not-exist")
      .expect(404, "Blog post not found");
    await request(app)
      .get("/blog/this-post-does-not-exist/")
      .expect(404, "Blog post not found");
  });
});
