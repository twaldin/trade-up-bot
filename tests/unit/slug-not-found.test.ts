import express from "express";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerBlogRoutes } from "../../server/blog-routes.js";
import { sendSlugNotFound, slugNotFoundHtml } from "../../server/seo.js";

const dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(dir, "../../server/index.ts"), "utf8");
const blogSource = readFileSync(resolve(dir, "../../server/blog-routes.ts"), "utf8");

describe("unknown slug documents", () => {
  it("includes a robots noindex meta tag and the message", () => {
    const html = slugNotFoundHtml("Skin not found");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain("Skin not found");
    expect(html).not.toContain("canonical");
    expect(html).not.toContain("<script");
  });

  it("sends HTTP 404 with X-Robots-Tag and the meta tag", async () => {
    const app = express();
    app.get("/missing", (_req, res) => {
      sendSlugNotFound(res, "Collection not found");
    });
    const res = await request(app).get("/missing").set("User-Agent", "Googlebot/2.1");
    expect(res.status).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain('name="robots" content="noindex"');
    expect(res.text).toContain("Collection not found");
  });
});

describe("unknown blog slugs", () => {
  function app() {
    const server = express();
    registerBlogRoutes(server, "<!doctype html><html><head><title></title></head><body><div id=\"root\"></div></body></html>");
    return server;
  }

  it("returns 404 html with noindex for both slash forms", async () => {
    const server = app();
    for (const path of ["/blog/not-a-real-post-xyz", "/blog/not-a-real-post-xyz/"]) {
      const res = await request(server).get(path).set("User-Agent", "Googlebot/2.1");
      expect(res.status).toBe(404);
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain('name="robots" content="noindex"');
      expect(res.text).toContain("Blog post not found");
    }
  });
});

describe("skin and collection slug routes", () => {
  it("uses the shared noindex 404 for unknown skin, collection, and collection trade-up slugs", () => {
    expect(indexSource.match(/sendSlugNotFound\(res, "Skin not found"\)/g)).toHaveLength(2);
    expect(indexSource).toContain('sendSlugNotFound(res, "Collection not found")');
    expect(indexSource).toContain('sendSlugNotFound(res, "Collection trade-up page not found")');
    expect(indexSource).not.toContain('res.status(404).send("Skin not found")');
    expect(indexSource).not.toContain('res.status(404).send("Collection not found")');
    expect(indexSource).not.toContain('res.status(404).send("Collection trade-up page not found")');
    expect(blogSource.match(/sendSlugNotFound\(res, "Blog post not found"\)/g)).toHaveLength(2);
  });
});
