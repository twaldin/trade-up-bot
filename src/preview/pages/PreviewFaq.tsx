import { Link } from "react-router-dom";
import { PreviewSeo } from "../components/PreviewSeo.js";
import { faqEntities, seoPage } from "../lib/seo-pages.js";

const seo = seoPage("/faq");
const QUESTIONS = faqEntities(seo);

const BLOG_LINKS = [
  { slug: "how-cs2-trade-ups-work", title: "How Trade-Up Contracts Work" },
  { slug: "cs2-trade-up-float-values-guide", title: "Float Values Guide" },
  { slug: "profitable-trade-ups-theory-vs-reality", title: "Theory vs Reality" },
  { slug: "cs2-trade-up-probability-expected-value", title: "Probability and Expected Value Guide" },
  { slug: "cs2-trade-up-marketplace-fees", title: "How Marketplace Fees Affect Profits" },
  { slug: "how-to-use-tradeupbot", title: "How to Use TradeUpBot" },
] as const;

function BlogLink({ slug, title }: { slug: string; title: string }) {
  return (
    <Link className="preview-link" to={`/blog/${slug}/`}>
      Read more: {title} →
    </Link>
  );
}

export function PreviewFaq() {
  return (
    <div className="preview-page preview-page--doc">
      <PreviewSeo title={seo.title} description={seo.description} canonical="https://tradeupbot.app/faq" jsonLd={seo.jsonLd} />
      <header className="preview-page__head">
        <div>
          <h1>CS2 Trade-Up FAQ</h1>
          <p>Answers to common CS2 trade-up questions about profitability, float values, marketplaces, fees, and TradeUpBot data.</p>
        </div>
      </header>

      <section className="preview-faq">
        {QUESTIONS.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <section className="preview-panel">
        <header className="preview-panel__head">
          <p className="o-kicker">Guides</p>
        </header>
        <div className="preview-stack">
          {BLOG_LINKS.map((item) => (
            <BlogLink key={item.slug} slug={item.slug} title={item.title} />
          ))}
        </div>
      </section>

      <div className="preview-toolbar">
        <Link className="preview-btn preview-btn--lime" to="/trade-ups">See profitable CS2 trade-ups</Link>
        <Link className="preview-btn" to="/calculator">Open the calculator</Link>
      </div>
    </div>
  );
}
