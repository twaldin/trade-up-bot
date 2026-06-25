/**
 * Plan 022: Funnel conversion — assert blog crawler HTML CTA links.
 *
 * server/blog-routes.ts builds a `blogBodyHtml` string that is served to crawlers
 * for every blog post. This test asserts that the crawler HTML contains followed
 * product links (/trade-ups, /calculator) and a rel="nofollow" auth link, and
 * that ONLY the auth link carries nofollow (product links must NOT be nofollow).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const blogRoutesSource = readFileSync(join(__dir, "../../server/blog-routes.ts"), "utf-8");

describe("blog crawler HTML CTA (Plan 022)", () => {
  it("contains a followed link to /trade-ups", () => {
    expect(blogRoutesSource).toContain('href="/trade-ups"');
  });

  it("contains a followed link to /calculator", () => {
    expect(blogRoutesSource).toContain('href="/calculator"');
  });

  it("contains a rel=nofollow link to /auth/steam", () => {
    // The auth link must have rel="nofollow"
    const authIdx = blogRoutesSource.indexOf('href="/auth/steam"');
    expect(authIdx).toBeGreaterThan(0);
    // Check the surrounding anchor tag for rel="nofollow"
    const tagStart = blogRoutesSource.lastIndexOf("<a ", authIdx);
    expect(tagStart).toBeGreaterThan(0);
    const tagEnd = blogRoutesSource.indexOf(">", tagStart);
    const tag = blogRoutesSource.slice(tagStart, tagEnd + 1);
    expect(tag).toContain('rel="nofollow"');
  });

  it("the /trade-ups link does NOT carry rel=nofollow", () => {
    const tuIdx = blogRoutesSource.indexOf('href="/trade-ups"');
    expect(tuIdx).toBeGreaterThan(0);
    const tagStart = blogRoutesSource.lastIndexOf("<a ", tuIdx);
    expect(tagStart).toBeGreaterThan(0);
    const tagEnd = blogRoutesSource.indexOf(">", tagStart);
    const tag = blogRoutesSource.slice(tagStart, tagEnd + 1);
    expect(tag).not.toContain("nofollow");
  });

  it("the /calculator link does NOT carry rel=nofollow", () => {
    const calcIdx = blogRoutesSource.indexOf('href="/calculator"');
    expect(calcIdx).toBeGreaterThan(0);
    const tagStart = blogRoutesSource.lastIndexOf("<a ", calcIdx);
    expect(tagStart).toBeGreaterThan(0);
    const tagEnd = blogRoutesSource.indexOf(">", tagStart);
    const tag = blogRoutesSource.slice(tagStart, tagEnd + 1);
    expect(tag).not.toContain("nofollow");
  });

  it("the CTA links appear within the blog route handler (CTA is appended to blogBodyHtml)", () => {
    // The CTA HTML is appended to blogBodyHtml — confirm that blogBodyHtml
    // references the CTA variable and that both are within the route handler scope.
    const bodyHtmlIdx = blogRoutesSource.indexOf("blogBodyHtml");
    expect(bodyHtmlIdx).toBeGreaterThan(0);
    // blogBodyHtml must reference ${ctaHtml} or include the CTA inline
    const bodyHtmlAssignmentIdx = blogRoutesSource.indexOf("const blogBodyHtml");
    expect(bodyHtmlAssignmentIdx).toBeGreaterThan(0);
    // The assignment must end with ctaHtml appended (either as variable or inline)
    const lineEnd = blogRoutesSource.indexOf(";", bodyHtmlAssignmentIdx);
    const assignmentLine = blogRoutesSource.slice(bodyHtmlAssignmentIdx, lineEnd + 1);
    // Must incorporate ctaHtml (variable reference) or contain the product links inline
    const hasCta = assignmentLine.includes("ctaHtml") ||
      (assignmentLine.includes("/trade-ups") && assignmentLine.includes("/calculator"));
    expect(hasCta).toBe(true);
  });
});
