import { useState, useEffect } from 'react';

const IconSteam = () => (
  <svg width="18" height="18" viewBox="0 0 256 259" fill="currentColor">
    <path d="M127.779 0C57.886 0 .478 55.048.017 124.241l68.83 28.438a35.821 35.821 0 0 1 20.268-6.26h1.9l30.32-43.91v-.615c0-27.277 22.189-49.467 49.467-49.467 27.277 0 49.466 22.19 49.466 49.502 0 27.278-22.189 49.467-49.466 49.467h-1.152l-43.205 30.862v1.355c0 20.47-16.627 37.131-37.131 37.131a37.256 37.256 0 0 1-36.606-30.622L6.592 171.62C25.058 220.857 72.378 256.2 127.779 256.2c70.674 0 127.962-57.288 127.962-127.962C255.741 57.566 198.453 0 127.779 0zM80.157 209.089l-15.637-6.456a27.885 27.885 0 0 0 25.36 16.158 27.957 27.957 0 0 0 27.927-27.927 27.957 27.957 0 0 0-27.927-27.928h-.034l16.268 6.727a20.58 20.58 0 0 1-13.86 38.849 20.476 20.476 0 0 1-12.097-9.423zm116.238-56.936c0-18.2-14.81-32.976-32.976-32.976-18.2 0-33.01 14.777-33.01 32.976 0 18.2 14.81 33.01 33.01 33.01 18.166 0 32.976-14.81 32.976-33.01zm-57.706-.035c0-13.69 11.047-24.772 24.73-24.772 13.724 0 24.771 11.082 24.771 24.772 0 13.69-11.047 24.772-24.771 24.772-13.683 0-24.73-11.082-24.73-24.772z" />
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
