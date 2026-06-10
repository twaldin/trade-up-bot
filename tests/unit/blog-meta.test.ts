import { describe, it, expect } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import { blogPosts } from "../../src/data/blog-posts.js";

describe("blog-meta", () => {
  it("has the same number of entries as blogPosts", () => {
    expect(blogMeta.length).toBe(blogPosts.length);
  });

  it("matches slug for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].slug).toBe(blogPosts[i].slug);
    }
  });

  it("matches title for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].title).toBe(blogPosts[i].title);
    }
  });

  it("matches excerpt for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].excerpt).toBe(blogPosts[i].excerpt);
    }
  });

  it("matches publishedAt for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].publishedAt).toBe(blogPosts[i].publishedAt);
    }
  });

  it("matches readTime for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].readTime).toBe(blogPosts[i].readTime);
    }
  });

  it("matches author for every entry", () => {
    for (let i = 0; i < blogPosts.length; i++) {
      expect(blogMeta[i].author).toBe(blogPosts[i].author);
    }
  });

  it("does not contain a 'content' property", () => {
    for (const entry of blogMeta) {
      expect(Object.prototype.hasOwnProperty.call(entry, "content")).toBe(false);
    }
  });
});
