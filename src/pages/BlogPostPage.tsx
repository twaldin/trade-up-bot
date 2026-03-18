import { Link, useParams } from "react-router-dom";
import { getPostBySlug, blogPosts } from "../data/blog-posts.js";
import { SiteNav } from "../components/SiteNav.js";
import { SiteFooter } from "../components/SiteFooter.js";

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Post not found</h1>
          <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to Blog
          </Link>
        </div>
      </div>
    );
  }

  const relatedPosts = blogPosts.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <SiteNav />

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          {/* Back link */}
          <Link
            to="/blog"
            className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            &larr; Back to Blog
          </Link>

          {/* Post header */}
          <header className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4 leading-tight">{post.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{post.author}</span>
              <span className="text-border">|</span>
              <time dateTime={post.publishedAt}>
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              <span className="text-border">|</span>
              <span>{post.readTime}</span>
            </div>
          </header>

          {/* Post content */}
          <article
            className="prose prose-invert prose-sm max-w-none
              prose-headings:text-foreground prose-headings:font-semibold
              prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4
              prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-4
              prose-a:text-foreground prose-a:underline prose-a:underline-offset-2
              prose-strong:text-foreground prose-strong:font-semibold
              prose-ul:text-muted-foreground prose-ul:my-4 prose-ul:space-y-1
              prose-ol:text-muted-foreground prose-ol:my-4 prose-ol:space-y-1
              prose-li:text-muted-foreground
              prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
              prose-table:text-sm prose-th:text-foreground prose-th:font-medium prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:border-b prose-th:border-border
              prose-td:text-muted-foreground prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-border/50"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {/* Related posts */}
          {relatedPosts.length > 0 && (
            <div className="mt-16 pt-10 border-t border-border">
              <h2 className="text-lg font-semibold mb-6">Related Posts</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {relatedPosts.map((related) => (
                  <Link
                    key={related.slug}
                    to={`/blog/${related.slug}`}
                    className="group border border-border rounded-lg p-4 hover:border-foreground/20 transition-colors"
                  >
                    <div className="text-xs text-muted-foreground mb-2">
                      {new Date(related.publishedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <h3 className="text-sm font-semibold mb-1 group-hover:text-foreground transition-colors">
                      {related.title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {related.excerpt}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
