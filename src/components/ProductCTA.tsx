import { Link } from "react-router-dom";

type CTAVariant = "blog" | "calculator" | "trade-ups";

interface ProductCTAProps {
  variant?: CTAVariant;
}

const COPY: Record<CTAVariant, {
  headline: string;
  subtext: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
  steamReturn: string;
}> = {
  blog: {
    headline: "See live profitable trade-ups right now",
    subtext: "TradeUpBot scans CSFloat, DMarket, and Skinport continuously. Every trade-up is built from real, buyable listings — fee-adjusted profit shown upfront. Free tier available.",
    primaryLabel: "Browse trade-ups",
    primaryHref: "/trade-ups",
    secondaryLabel: "Try the calculator",
    secondaryHref: "/calculator",
    steamReturn: "/trade-ups",
  },
  calculator: {
    headline: "Want pre-built profitable trade-ups?",
    subtext: "TradeUpBot scans live marketplace listings and surfaces the contracts that actually profit — with fee-adjusted EV and float-precise output pricing. Free tier available.",
    primaryLabel: "Browse trade-ups",
    primaryHref: "/trade-ups",
    secondaryLabel: "See features",
    secondaryHref: "/features",
    steamReturn: "/trade-ups",
  },
  "trade-ups": {
    headline: "Build your own trade-up from scratch",
    subtext: "Paste any 10 skins, set your floats and prices, and the calculator shows you exact output probabilities, expected value, and fee-adjusted profit — before you spend a cent.",
    primaryLabel: "Try the calculator",
    primaryHref: "/calculator",
    secondaryLabel: "See features",
    secondaryHref: "/features",
    steamReturn: "/calculator",
  },
};

export function ProductCTA({ variant = "blog" }: ProductCTAProps) {
  const copy = COPY[variant];
  return (
    <div className="mt-10 rounded-xl border border-border bg-card px-6 py-7">
      <h2 className="text-lg font-bold mb-2">{copy.headline}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">{copy.subtext}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={copy.primaryHref}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
        >
          {copy.primaryLabel}
        </Link>
        <Link
          to={copy.secondaryHref}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg border border-border hover:border-foreground/30 transition-colors text-foreground"
        >
          {copy.secondaryLabel}
        </Link>
        <a
          href={`/auth/steam?return=${encodeURIComponent(copy.steamReturn)}`}
          rel="nofollow"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in with Steam — free
        </a>
      </div>
    </div>
  );
}
