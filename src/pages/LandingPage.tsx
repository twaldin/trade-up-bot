import { useState, useEffect } from 'react';

const IconSteam = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const Btn = ({ children, variant = 'primary', className = '', onClick }: {
  children: React.ReactNode; variant?: 'primary' | 'outline'; className?: string; onClick?: () => void;
}) => {
  const styles = {
    primary: "bg-foreground text-background hover:bg-foreground/90",
    outline: "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
};

interface GlobalStats {
  total_trade_ups: number;
  profitable_trade_ups: number;
  total_data_points: number;
  uptime_ms: number;
}

const LandingPage = () => {
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch("/api/global-stats").then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const login = () => { window.location.href = '/auth/steam'; };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">

      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <span className="font-bold tracking-tight">TradeUpBot</span>
          <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <Btn onClick={login} className="h-8 px-3 text-xs">
            <IconSteam /> Sign In
          </Btn>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="pt-28 pb-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-3xl mb-12">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-[1.1]">
                Find profitable CS2<br />trade-ups in real time
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-xl">
                Market data from CSFloat, DMarket, and Skinport. Thousands of combinations evaluated every 12 minutes across all rarity tiers.
              </p>
              <div className="flex items-center gap-4">
                <Btn onClick={login} className="px-6 py-3">
                  <IconSteam /> Sign in with Steam
                </Btn>
                <span className="text-xs text-muted-foreground">Free to start</span>
              </div>
            </div>

            {/* Stats */}
            {stats && (
              <div className="flex gap-8 mb-12 text-sm">
                <div><span className="text-foreground font-semibold tabular-nums">{stats.total_trade_ups.toLocaleString()}</span> <span className="text-muted-foreground">trade-ups</span></div>
                <div><span className="text-green-500 font-semibold tabular-nums">{stats.profitable_trade_ups.toLocaleString()}</span> <span className="text-muted-foreground">profitable</span></div>
                <div><span className="text-foreground font-semibold tabular-nums">{stats.total_data_points.toLocaleString()}</span> <span className="text-muted-foreground">data points</span></div>
              </div>
            )}

            {/* Screenshot */}
            <img src="/tradeuptable.png" alt="Trade-Up Bot" className="rounded-lg border border-border shadow-2xl w-full" />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid md:grid-cols-2 gap-12 mb-20">
              <div>
                <h2 className="text-2xl font-bold mb-3">Outcome analysis</h2>
                <p className="text-muted-foreground mb-6">Every possible outcome with probabilities, expected value, and the exact inputs needed. Claim to lock listings for 30 minutes while you buy.</p>
                <img src="/expanded.png" alt="Trade-up outcomes" className="rounded-lg border border-border w-full" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-3">Price intelligence</h2>
                <p className="text-muted-foreground mb-6">Float vs price scatter charts with data from CSFloat, DMarket, Skinport, and sale history across every condition.</p>
                <img src="/dataviewer.png" alt="Price data" className="rounded-lg border border-border w-full" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-3">89 collections covered</h2>
              <p className="text-muted-foreground mb-6">Browse every collection with knife/glove pool info, listing counts, and profitable trade-ups. Filter by knives, gloves, or profitability.</p>
              <img src="/collections.png" alt="Collections" className="rounded-lg border border-border w-full" />
            </div>
          </div>
        </section>

        {/* How it works — clean, no emojis */}
        <section className="py-20 border-t border-border">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-2xl font-bold mb-10 text-center">How it works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { n: "01", title: "Scan", desc: "Listings pulled from CSFloat, DMarket, and Skinport every cycle. Continuous DMarket coverage at 2 req/s." },
                { n: "02", title: "Discover", desc: "Algorithms test thousands of input combinations at 45+ float targets. Swap optimization improves results each cycle." },
                { n: "03", title: "Claim", desc: "Pro users see results instantly. Claim a trade-up to lock listings for 30 minutes while you buy." },
              ].map((s, i) => (
                <div key={i}>
                  <div className="text-xs text-muted-foreground/50 font-mono mb-2">{s.n}</div>
                  <h3 className="font-semibold mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Rarity tiers — using app pill styles */}
        <section className="py-20 border-t border-border">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-2xl font-bold mb-3 text-center">All rarity tiers</h2>
            <p className="text-muted-foreground text-center mb-10">From cheap Mil-Spec skins to Knife/Glove contracts.</p>
            <div className="space-y-2">
              {[
                { name: "Knife / Gloves", cls: "border-yellow-500/30 text-yellow-500", desc: "5 Covert → Knife or Glove" },
                { name: "Covert", cls: "border-red-500/30 text-red-500", desc: "10 Classified → Covert" },
                { name: "Classified", cls: "border-pink-500/30 text-pink-500", desc: "10 Restricted → Classified" },
                { name: "Restricted", cls: "border-purple-500/30 text-purple-500", desc: "10 Mil-Spec → Restricted" },
                { name: "Mil-Spec", cls: "border-blue-500/30 text-blue-500", desc: "10 Industrial → Mil-Spec" },
              ].map((t, i) => (
                <div key={i} className={`flex items-center justify-between py-3 px-4 rounded-lg border ${t.cls}`}>
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-20 border-t border-border">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-2xl font-bold mb-2 text-center">Pricing</h2>
            <p className="text-muted-foreground text-center mb-12">Start free. Upgrade when you're ready.</p>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Free */}
              <div className="rounded-xl border border-border p-6 flex flex-col">
                <div className="mb-6">
                  <div className="text-sm text-muted-foreground mb-1">Free</div>
                  <div className="text-3xl font-bold">$0</div>
                </div>
                <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 10 sample trade-ups per tier</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Full outcome details</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Sort columns</li>
                  <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No listing links</li>
                  <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No filters</li>
                  <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No claims</li>
                </ul>
                <Btn variant="outline" onClick={login} className="w-full">Get started</Btn>
              </div>

              {/* Basic */}
              <div className="rounded-xl border border-border p-6 flex flex-col">
                <div className="mb-6">
                  <div className="text-sm mb-1">Basic</div>
                  <div className="text-3xl font-bold">$5<span className="text-sm text-muted-foreground font-normal">/mo</span></div>
                </div>
                <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Unlimited trade-ups</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 30-min delay on new finds</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Filters, search, pagination</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Direct listing links</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Verify availability</li>
                  <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No claims</li>
                </ul>
                <Btn variant="outline" onClick={login} className="w-full">Subscribe</Btn>
              </div>

              {/* Pro */}
              <div className="rounded-xl border border-foreground/20 p-6 flex flex-col bg-foreground/[0.03]">
                <div className="mb-6">
                  <div className="text-sm text-green-500 mb-1">Pro</div>
                  <div className="text-3xl font-bold">$15<span className="text-sm text-muted-foreground font-normal">/mo</span></div>
                </div>
                <ul className="space-y-2.5 mb-6 flex-1 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Everything in Basic</li>
                  <li className="flex items-center gap-2"><IconCheck /> Real-time data</li>
                  <li className="flex items-center gap-2"><IconCheck /> Claim system (30 min lock)</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Up to 5 active claims</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Collection browser</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Price analytics</li>
                </ul>
                <Btn onClick={login} className="w-full">Go Pro</Btn>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <a href="https://github.com/twaldin/trade-up-bot" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
};

export { LandingPage };
