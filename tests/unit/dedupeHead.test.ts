import { describe, it, expect } from "vitest";
import { dedupeHead } from "../../server/seo";

describe("dedupeHead", () => {
  it("keeps only last non-empty title when duplicates include empty", () => {
    const html = `<!doctype html><html><head><title></title><title>First Title</title><title>Second Title</title></head><body></body></html>`;
    const out = dedupeHead(html);
    expect(out).toContain("<title>Second Title</title>");
    expect((out.match(/<title>/g) || []).length).toBe(1);
    expect(out).not.toContain("<title></title>");
    expect(out).not.toContain("<title>First Title</title>");
  });

  it("keeps only last meta description", () => {
    const html = `<html><head><meta name="description" content="a"><meta name="description" content="b"></head></html>`;
    const out = dedupeHead(html);
    expect((out.match(/meta name="description"/g) || []).length).toBe(1);
    expect(out).toContain('content="b"');
    expect(out).not.toContain('content="a"');
  });

  it("keeps only last canonical link", () => {
    const html = `<html><head><link rel="canonical" href="https://a"><link rel="canonical" href="https://b"></head></html>`;
    const out = dedupeHead(html);
    expect((out.match(/rel="canonical"/g) || []).length).toBe(1);
    expect(out).toContain('href="https://b"');
    expect(out).not.toContain('href="https://a"');
  });

  it("dedupes og tags by key", () => {
    const html = `<html><head><meta property="og:title" content="A"><meta property="og:title" content="B"><meta property="og:description" content="D"></head></html>`;
    const out = dedupeHead(html);
    expect((out.match(/property="og:title"/g) || []).length).toBe(1);
    expect((out.match(/property="og:description"/g) || []).length).toBe(1);
    expect(out).toContain('content="B"');
    expect(out).not.toContain('content="A"');
  });

  it("prefers helmet meta tags when duplicates include data-rh", () => {
    const html = `<html><head><meta name="description" content="Template"><meta name="description" content="Helmet" data-rh="true"><meta property="og:description" content="Template"><meta property="og:description" content="Helmet" data-rh="true"></head></html>`;
    const out = dedupeHead(html);
    expect((out.match(/name="description"/g) || []).length).toBe(1);
    expect((out.match(/property="og:description"/g) || []).length).toBe(1);
    expect(out).toContain('content="Helmet"');
    expect(out).not.toContain('content="Template"');
  });

  it("dedupes twitter tags by key", () => {
    const html = `<html><head><meta name="twitter:image" content="a.png"><meta name="twitter:image" content="b.png"></head></html>`;
    const out = dedupeHead(html);
    expect((out.match(/name="twitter:image"/g) || []).length).toBe(1);
    expect(out).toContain('content="b.png"');
    expect(out).not.toContain('content="a.png"');
  });

  it("does not touch tags outside head", () => {
    const html = `<html><head><title>Ok</title></head><body><title>Outside</title><meta name="description" content="outside"></body></html>`;
    const out = dedupeHead(html);
    expect(out).toContain("<title>Outside</title>");
    expect(out).toContain('<meta name="description" content="outside">');
  });
});
