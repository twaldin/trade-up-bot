import { Link, useParams } from "react-router-dom";
import { blogMeta } from "../../data/blog-meta.js";
import { blogPosts, getPostBySlug } from "../../data/blog-posts.js";
import { authHref } from "../../lib/ref.js";
import { trackEvent } from "../../lib/analytics.js";
import { PreviewSeo } from "../components/PreviewSeo.js";

const INDEX_TITLE = "Blog — CS2 Trade-Up Guides & Analysis | TradeUpBot";
const INDEX_DESCRIPTION = "Guides and analysis on CS2 trade-up contracts, float mechanics, marketplace strategy, and how to find profitable trade-ups.";

function formatDate(iso: string, long = false): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: long ? "long" : "short",
    day: "numeric",
  });
}

export function PreviewBlogIndex() {
  return (
    <div className="preview-market">
      <PreviewSeo title={INDEX_TITLE} description={INDEX_DESCRIPTION} canonical="https://tradeupbot.app/blog" />
      <header className="preview-page__head">
        <div>
          <h1>CS2 Trade-Up Guides & Analysis</h1>
          <p>Guides and analysis on CS2 trade-up contracts, float mechanics, and marketplace strategy.</p>
        </div>
        <div className="preview-page__meta"><span>{blogMeta.length} guides</span></div>
      </header>
      <div className="preview-posts">
        {blogMeta.map((post) => (
          <Link key={post.slug} className="preview-panel preview-post" to={`/blog/${post.slug}/`}>
            <p className="preview-note">
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              {" · "}
              {post.readTime}
            </p>
            <h2>{post.title}</h2>
            <p>{post.excerpt}</p>
            <span className="preview-note">{post.author}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PreviewBlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  if (!post) {
    return (
      <div className="preview-page">
        <header className="preview-page__head">
          <div>
            <h1>Post not found</h1>
            <p>That guide is not in the live set.</p>
          </div>
        </header>
        <Link className="preview-btn" to="/blog">Back to Blog</Link>
      </div>
    );
  }

  const relatedPosts = blogPosts.filter((row) => row.slug !== post.slug).slice(0, 2);
  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    author: { "@type": "Organization", name: post.author },
    publisher: { "@type": "Organization", name: "TradeUpBot", url: "https://tradeupbot.app" },
    mainEntityOfPage: `https://tradeupbot.app/blog/${post.slug}/`,
  };
  const faqJsonLd = post.faq
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: post.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : undefined;
  const jsonLd = faqJsonLd ? [blogPostingJsonLd, faqJsonLd] : blogPostingJsonLd;

  return (
    <div className="preview-market">
      <PreviewSeo
        title={`${post.title} | TradeUpBot`}
        description={post.excerpt}
        canonical={`https://tradeupbot.app/blog/${post.slug}/`}
        jsonLd={jsonLd}
      />
      <header className="preview-page__head">
        <div>
          <nav className="preview-crumb" aria-label="Breadcrumb">
            <Link className="preview-link" to="/blog">Blog</Link>
            <span aria-hidden>/</span>
            <span>{post.title}</span>
          </nav>
          <h1>{post.title}</h1>
          <p>
            {post.author}
            {" · "}
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, true)}</time>
            {" · "}
            {post.readTime}
          </p>
        </div>
      </header>

      <article className="preview-doc" dangerouslySetInnerHTML={{ __html: post.content }} />

      <section className="preview-panel preview-cta">
        <header className="preview-panel__head">
          <p className="o-kicker">Next</p>
        </header>
        <h2>See live profitable trade-ups right now</h2>
        <p className="preview-note">TradeUpBot scans CSFloat, DMarket, and Skinport continuously. Every trade-up is built from live listings, with marketplace fees factored into profit. Free tier available.</p>
        <div className="preview-toolbar">
          <Link className="preview-btn preview-btn--lime" to="/trade-ups">Browse trade-ups</Link>
          <Link className="preview-btn" to="/calculator">Try the calculator</Link>
          <a
            className="preview-btn preview-btn--quiet"
            href={authHref("/trade-ups")}
            onClick={() => trackEvent("sign_up_start", { location: "cta_blog" })}
            rel="nofollow"
          >
            Sign in with Steam — free
          </a>
        </div>
      </section>

      {relatedPosts.length > 0 && (
        <section className="preview-posts">
          <p className="o-kicker">Related Posts</p>
          {relatedPosts.map((related) => (
            <Link key={related.slug} className="preview-panel preview-post" to={`/blog/${related.slug}/`}>
              <p className="preview-note">{formatDate(related.publishedAt)}</p>
              <h2>{related.title}</h2>
              <p>{related.excerpt}</p>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
