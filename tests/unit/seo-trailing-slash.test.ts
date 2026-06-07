import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { registerCanonicalRedirectRoutes } from "../../server/canonical-redirects.js";
import { registerBlogRoutes } from "../../server/blog-routes.js";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";

const knownSlug = "how-cs2-trade-ups-work";

describe("blog post canonical uses trailing slash (#2)", () => {
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

describe("canonical no-trailing-slash routes", () => {
  function createApp() {
    const app = express();
    registerCanonicalRedirectRoutes(app);
    app.get("/calculator", (_req, res) => res.status(200).send("calculator"));
    app.get("/trade-ups", (_req, res) => res.status(200).send("trade-ups"));
    app.get("/skins/:slug", (_req, res) => res.status(200).send("skin"));
    app.get("/collections/:slug", (_req, res) => res.status(200).send("collection"));
    return app;
  }

  it("redirects static no-slash canonical routes before Express serves both forms", async () => {
    const response = await request(createApp())
      .get("/calculator/")
      .expect(301);

    expect(response.headers.location).toBe("/calculator");
  });

  it("preserves query strings when redirecting canonical route variants", async () => {
    const response = await request(createApp())
      .get("/trade-ups/?type=classified_covert")
      .expect(301);

    expect(response.headers.location).toBe("/trade-ups?type=classified_covert");
  });

  it("redirects dynamic skin and collection trailing-slash variants", async () => {
    const app = createApp();

    const skin = await request(app)
      .get("/skins/ak-47-redline/")
      .expect(301);
    const collection = await request(app)
      .get("/collections/dreams-nightmares/")
      .expect(301);

    expect(skin.headers.location).toBe("/skins/ak-47-redline");
    expect(collection.headers.location).toBe("/collections/dreams-nightmares");
  });

  it("does not redirect canonical trailing-slash blog post URLs", async () => {
    const app = express();
    registerCanonicalRedirectRoutes(app);
    registerBlogRoutes(app, "<!doctype html><html><head><title></title></head><body><div id=\"root\"></div></body></html>");

    const response = await request(app)
      .get(`/blog/${knownSlug}/`)
      .set("User-Agent", "Googlebot")
      .expect(200);

    expect(response.text).toContain(`<link rel="canonical" href="https://tradeupbot.app/blog/${knownSlug}/" />`);
  });
});
