import { Link } from "react-router-dom";
import { blogPosts } from "../data/blog-posts.js";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

export function BlogPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Blog</h1>
          <p className="text-muted-foreground mb-10">
            Guides and analysis on CS2 trade-up contracts, float mechanics, and marketplace strategy.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {blogPosts.map((post) => (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  <span className="text-border">|</span>
                  <span>{post.readTime}</span>
                </div>
                <h2 className="text-base font-semibold mb-2 group-hover:text-foreground transition-colors">
                  {post.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                  {post.excerpt}
                </p>
                <div className="mt-3 text-xs text-muted-foreground/60">
                  {post.author}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
