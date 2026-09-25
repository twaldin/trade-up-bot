import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { trackDiscordCta } from "../lib/analytics.js";
import { PreviewCurrency } from "./components/PreviewCurrency.js";
import { PreviewMark } from "./components/PreviewMark.js";
import { useCanonicalSlot } from "./components/PreviewSeo.js";
import { buildHomepageJsonLd } from "../../shared/crawler-jsonld.js";
import {
  PREVIEW_CTA_PRIMARY,
  PREVIEW_DISCORD_HREF,
  PREVIEW_GITHUB_HREF,
  FOOTER_AGE,
  FOOTER_NOT_VALVE,
  HOME_DESCRIPTION,
  HOME_TITLE,
  PREVIEW_HEADLINE,
} from "./lib/copy.js";

const PRODUCT = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/blog", label: "Blog" },
] as const;

export function PreviewChrome({
  children,
  mode,
  onMode,
  home = false,
}: {
  children: ReactNode;
  mode: "light" | "dark";
  onMode: () => void;
  home?: boolean;
}) {
  const emitCanonical = useCanonicalSlot(home ? "https://tradeupbot.app/" : "");
  return (
    <div data-preview data-system="outlay" data-mode={mode} data-view="landing">
      {home && (
        <>
          <title>{HOME_TITLE}</title>
          <meta name="description" content={HOME_DESCRIPTION} />
          <meta name="robots" content="index, follow" />
          {home && emitCanonical && <link rel="canonical" href="https://tradeupbot.app/" />}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildHomepageJsonLd()) }} />
        </>
      )}
      <header className="preview-nav">
        <Link to="/" className="preview-brand">
          <PreviewMark size={20} />
          TradeUpBot
        </Link>
        <nav className="preview-nav__links" aria-label="Product">
          {PRODUCT.map((item) => (
            <Link key={item.to} className="preview-btn preview-btn--quiet" to={item.to}>{item.label}</Link>
          ))}
        </nav>
        <div className="preview-bar__actions">
          <div className="preview-nav__prefs">
            <button type="button" className="preview-btn" onClick={onMode}>
              {mode === "dark" ? "Light" : "Dark"}
            </button>
            <PreviewCurrency />
          </div>
          <Link className="preview-btn preview-btn--lime preview-nav__cta" to="/trade-ups">{PREVIEW_CTA_PRIMARY}</Link>
        </div>
      </header>
      {children}
      <footer className="preview-footer">
        <div className="preview-footer__grid">
          <div>
            <p className="preview-footer__brand">TradeUpBot</p>
            <p>{PREVIEW_HEADLINE}.</p>
            <p>
              <a href={PREVIEW_GITHUB_HREF} target="_blank" rel="noopener noreferrer">GitHub</a>
              {" · "}
              <a href={PREVIEW_DISCORD_HREF} target="_blank" rel="noopener noreferrer" onClick={() => trackDiscordCta("footer")}>Discord</a>
              {" · "}
              <a href="mailto:tradeupbot@gmail.com">tradeupbot@gmail.com</a>
            </p>
          </div>
          <div>
            <p className="o-kicker">Product</p>
            <Link to="/features">Features</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/faq">FAQ</Link>
            <Link to="/blog">Blog</Link>
          </div>
          <div>
            <p className="o-kicker">Tools</p>
            <Link to="/trade-ups">Board</Link>
            <Link to="/skins">Skins</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/calculator">Calculator</Link>
          </div>
          <div>
            <p className="o-kicker">Legal</p>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
        </div>
        <p className="preview-footer__legal">
          {FOOTER_NOT_VALVE} CS2 and Counter-Strike are trademarks of Valve Corporation.
        </p>
        <p className="preview-footer__legal">{FOOTER_AGE}</p>
      </footer>
    </div>
  );
}
