import { useNavigate } from "react-router-dom";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-3xl sm:text-4xl font-bold text-foreground text-center mb-4">
      {children}
    </h2>
  );
}

function SectionSubheading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12 text-lg">
      {children}
    </p>
  );
}

// -- Hero --

function Hero() {
  const navigate = useNavigate();

  return (
    <section className="flex flex-col items-center text-center pt-16 pb-20 px-4">
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-border bg-muted/50 text-sm text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-green-500 animate-pulse" />
        Live — scanning markets now
      </div>

      <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground max-w-3xl leading-[1.1]">
        CS2 Trade-Up
        <br />
        <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          Intelligence
        </span>
      </h1>

      <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed">
        Find profitable trade-up contracts across every rarity tier.
        Real-time pricing from CSFloat, DMarket, and Skinport — math does the work.
      </p>

      <div className="flex flex-wrap justify-center gap-3 mt-10">
        <button
          onClick={() => window.location.href = "/auth/steam"}
          className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:translate-y-px"
        >
          Get Started
        </button>
        <button
          onClick={() => window.location.href = "/demo"}
          className="h-11 px-6 rounded-lg border border-border bg-background text-foreground font-semibold text-sm transition-all hover:bg-muted active:translate-y-px"
        >
          View Demo
        </button>
      </div>

      {/* Social proof stat */}
      <div className="mt-12 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">900+</strong> profitable knife trade-ups tracked
        </span>
        <span className="hidden sm:inline text-border">|</span>
        <span>
          <strong className="text-foreground">6</strong> rarity tiers
        </span>
        <span className="hidden sm:inline text-border">|</span>
        <span>
          <strong className="text-foreground">10-min</strong> refresh cycles
        </span>
      </div>
    </section>
  );
}

// -- How It Works --

const STEPS = [
  {
    icon: "\u{1F50D}",
    title: "We Scan Markets",
    description:
      "Continuous ingestion from CSFloat, DMarket, and Skinport. Every listing, every sale, every price point — catalogued in real time.",
  },
  {
    icon: "\u{1F9EE}",
    title: "Calculate Every Combo",
    description:
      "50K+ trade-ups evaluated per cycle across all rarity tiers. Float-targeted discovery with 45+ targets per combination.",
  },
  {
    icon: "\u{1F4B0}",
    title: "You Profit",
    description:
      "Browse results sorted by ROI, EV, or chance-to-profit. Click through to actual marketplace listings and execute.",
  },
];

function HowItWorks() {
  return (
    <section className="py-20 px-4">
      <SectionHeading>How It Works</SectionHeading>
      <SectionSubheading>
        Three steps between you and consistent trade-up profits.
      </SectionSubheading>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {STEPS.map((step, i) => (
          <div key={i} className="relative flex flex-col items-center text-center p-6 rounded-xl border border-border bg-card">
            {/* Step number */}
            <div className="absolute -top-3 -left-3 size-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
              {i + 1}
            </div>
            <span className="text-4xl mb-4">{step.icon}</span>
            <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// -- Features --

const FEATURES = [
  {
    icon: "\u{1F48E}",
    title: "6 Rarity Tiers",
    description:
      "From Industrial Grade all the way up to Covert-to-Knife. Every viable trade-up path is covered, including multi-step staircases.",
  },
  {
    icon: "\u{1F4CA}",
    title: "Real-Time Market Data",
    description:
      "Prices from CSFloat, DMarket, and Skinport aggregated with conservative output pricing. No stale data, no guesswork.",
  },
  {
    icon: "\u{1F3AF}",
    title: "Float-Targeted Discovery",
    description:
      "45+ float targets per combination. The engine picks optimal listings to land specific output conditions for maximum value.",
  },
  {
    icon: "\u{1F3B2}",
    title: "Chance-to-Profit Scoring",
    description:
      "Every trade-up shows exact probability of each outcome. Know your odds before you spend a cent.",
  },
  {
    icon: "\u{1F525}",
    title: "Profit Streak Tracking",
    description:
      "Track which trade-ups stay profitable across cycles. Consistent performers surface to the top.",
  },
  {
    icon: "\u{1F512}",
    title: "Claim System",
    description:
      "Lock a trade-up for 30 minutes while you buy the inputs. No one else sees it. Execute without competition.",
  },
];

function Features() {
  return (
    <section className="py-20 px-4">
      <SectionHeading>Features</SectionHeading>
      <SectionSubheading>
        Everything you need to find, evaluate, and execute profitable trade-ups.
      </SectionSubheading>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {FEATURES.map((f, i) => (
          <div
            key={i}
            className="p-5 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors"
          >
            <span className="text-2xl">{f.icon}</span>
            <h3 className="mt-3 text-base font-semibold text-foreground">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// -- Pricing --

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Explore the system, see what's possible.",
    features: [
      "10 results per type",
      "30-minute data delay",
      "Basic filters",
      "No listing links",
    ],
    highlighted: false,
    cta: "Start Free",
  },
  {
    name: "Basic",
    price: "$5",
    period: "/mo",
    description: "For active traders who want the full picture.",
    features: [
      "All results, all tiers",
      "5-minute data delay",
      "Full listing links",
      "Advanced filters",
      "Collection browser",
    ],
    highlighted: false,
    cta: "Get Basic",
  },
  {
    name: "Pro",
    price: "$15",
    period: "/mo",
    description: "Maximum edge. Real-time data, exclusive access.",
    features: [
      "Real-time results",
      "Claim system (30-min lock)",
      "Price alerts",
      "API access",
      "CSV / JSON export",
      "Priority support",
    ],
    highlighted: true,
    cta: "Go Pro",
  },
];

function Pricing() {
  return (
    <section className="py-20 px-4">
      <SectionHeading>Pricing</SectionHeading>
      <SectionSubheading>
        Start free. Upgrade when the profits justify it.
      </SectionSubheading>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto items-start">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`relative flex flex-col p-6 rounded-xl border transition-colors ${
              tier.highlighted
                ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                : "border-border bg-card"
            }`}
          >
            {tier.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                Most Popular
              </div>
            )}

            <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-foreground">{tier.price}</span>
              <span className="text-sm text-muted-foreground">{tier.period}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{tier.description}</p>

            <ul className="mt-6 space-y-2 flex-1">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="text-green-500 mt-0.5 shrink-0">{"\u2713"}</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              className={`mt-6 h-10 w-full rounded-lg font-semibold text-sm transition-all active:translate-y-px ${
                tier.highlighted
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "border border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {tier.cta}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// -- Stats --

const STATS = [
  { value: "120K+", label: "Price observations" },
  { value: "50K+", label: "Trade-ups per cycle" },
  { value: "6", label: "Rarity tiers" },
  { value: "10 min", label: "Refresh cycles" },
];

function Stats() {
  return (
    <section className="py-20 px-4">
      <div className="max-w-4xl mx-auto rounded-xl border border-border bg-card p-8 sm:p-12">
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-8">
          By the Numbers
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-3xl sm:text-4xl font-extrabold text-foreground">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -- Footer --

function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="border-t border-border mt-12 py-10 px-4">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="text-center sm:text-left">
          <p className="text-sm text-muted-foreground">
            Built for the CS2 community.
          </p>
          <a
            href="https://github.com/twaldin/trade-up-bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>

        <button
          onClick={() => window.location.href = "/auth/steam"}
          className="h-10 px-5 rounded-lg border border-border bg-background text-foreground font-semibold text-sm transition-all hover:bg-muted active:translate-y-px flex items-center gap-2"
        >
          <span>{"\u{1F3AE}"}</span>
          Sign in with Steam
        </button>
      </div>
    </footer>
  );
}

// -- Page --

export function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Top nav bar */}
      <nav className="flex items-center justify-between py-4 px-4 max-w-6xl mx-auto">
        <span className="text-lg font-bold text-foreground">CS2 Trade-Up Bot</span>
        <a
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign In
        </a>
      </nav>

      <div className="max-w-6xl mx-auto">
        <Hero />
        <HowItWorks />
        <Features />
        <Pricing />
        <Stats />
        <Footer />
      </div>
    </div>
  );
}
