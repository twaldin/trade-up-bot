import React, { useState, useEffect } from 'react';

const IconSteam = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.377 0 0 5.377 0 12c0 .937.108 1.848.31 2.723l5.547 2.292c.31-.114.65-.183 1.005-.183.163 0 .32.016.473.045l2.64-3.878V13c0-2.206 1.794-4 4-4s4 1.794 4 4-1.794 4-4 4c-.163 0-.32-.016-.473-.045l-3.878 2.64h-.001c.03.153.045.31.045.473 0 1.381-1.119 2.5-2.5 2.5-.355 0-.695-.07-1.005-.183L.416 16.148C2.158 20.762 6.692 24 12 24c6.623 0 12-5.377 12-12S18.623 0 12 0zm0 15c-1.103 0-2-.897-2-2s.897-2 2-2 2 .897 2 2-.897 2-2 2z" />
  </svg>
);

const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

const Button = ({
  children,
  variant = 'primary',
  className = '',
  onClick
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'outline' | 'ghost';
  className?: string;
  onClick?: () => void;
}) => {
  const base = "inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-all duration-200 rounded-lg active:scale-[0.98] will-change-transform cursor-pointer";
  const variants = {
    primary: "bg-[hsl(var(--cta))] text-[hsl(var(--cta-foreground))] hover:bg-[hsl(var(--cta-hover))] shadow-[0_0_0_1px_hsl(var(--cta)/0.5),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[0_0_0_1px_hsl(var(--cta)/0.5),0_4px_12px_hsl(var(--cta)/0.3)]",
    outline: "bg-transparent border border-[hsl(var(--surface-border))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--surface-hover))] hover:border-[hsl(var(--surface-border-hover))]",
    ghost: "bg-transparent text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
  };
  return (
    <button onClick={onClick} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "", highlighted = false }: { children: React.ReactNode; className?: string; highlighted?: boolean }) => (
  <div className={`
    relative overflow-hidden rounded-2xl bg-[hsl(var(--surface))]
    ring-1 ring-[hsl(var(--surface-ring))] backdrop-blur-sm
    ${highlighted ? 'ring-[hsl(var(--cta)/0.5)] shadow-[0_0_40px_-10px_hsl(var(--cta)/0.2)]' : 'shadow-xl'}
    ${className}
  `}>
    {children}
  </div>
);

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

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-[hsl(var(--cta)/0.3)] font-sans antialiased">

      {/* Navigation */}
      <nav className="fixed top-0 z-50 w-full border-b border-[hsl(var(--surface-ring))] bg-[hsl(var(--background)/0.8)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-bold tracking-tight text-xl">
            <div className="h-6 w-6 rounded bg-[hsl(var(--cta))] flex items-center justify-center text-[10px] text-[hsl(var(--cta-foreground))]">TB</div>
            TradeUpBot
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[hsl(var(--text-muted))]">
            <a href="#how" className="hover:text-foreground transition-colors">How it Works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <Button onClick={() => window.location.href = '/auth/steam'} className="h-9 px-4">
            <IconSteam /> Sign In with Steam
          </Button>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-20 overflow-hidden">
          <div className="absolute top-0 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 bg-[hsl(var(--cta)/0.1)] blur-[120px] rounded-full" />

          <div className="mx-auto max-w-7xl px-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--cta)/0.1)] px-3 py-1 text-xs font-semibold text-[hsl(var(--cta))] ring-1 ring-inset ring-[hsl(var(--cta)/0.2)] mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--cta))] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--cta))]"></span>
              </span>
              Live — Analyzing {stats ? stats.total_trade_ups.toLocaleString() : "200,000+"} trade-ups
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
              Find Profitable CS2 Trade-Ups <br className="hidden sm:block" />
              <span className="text-[hsl(var(--text-muted))]">Before Anyone Else</span>
            </h1>

            <p className="mx-auto max-w-2xl text-lg text-[hsl(var(--text-secondary))] mb-10">
              Real-time market data from CSFloat, DMarket, and Skinport. Our engine evaluates
              thousands of listing combinations every 12 minutes across all rarity tiers to find
              profitable trade-ups the market hasn't noticed yet.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <Button onClick={() => window.location.href = '/auth/steam'} className="w-full sm:w-auto px-8 py-4 text-base">
                <IconSteam /> Sign in with Steam — Free
              </Button>
            </div>

            {/* Live stats from API */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto mb-16">
                {[
                  { label: "Trade-Ups Tracked", value: stats.total_trade_ups.toLocaleString() },
                  { label: "Profitable Found", value: stats.profitable_trade_ups.toLocaleString(), color: "text-green-500" },
                  { label: "Price Data Points", value: stats.total_data_points.toLocaleString() },
                  { label: "Update Cycle", value: "12 min" },
                ].map((s, i) => (
                  <div key={i} className="text-center">
                    <div className="text-[hsl(var(--text-muted))] text-[10px] font-bold uppercase tracking-widest mb-1">{s.label}</div>
                    <div className={`text-2xl font-bold tabular-nums ${s.color || "text-foreground"}`}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* How It Works */}
        <section id="how" className="py-24 border-t border-[hsl(var(--surface-ring))]">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="text-3xl font-bold mb-12 text-center">How It Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { title: "Market Scanning", desc: "We pull listings from CSFloat, DMarket, and Skinport every cycle. DMarket fetcher runs continuously at 2 requests/second for maximum coverage.", icon: "📡" },
                { title: "Smart Discovery", desc: "Algorithms test thousands of input combinations at 45+ float targets per collection. Swap optimization improves existing profitable trade-ups each cycle.", icon: "🧠" },
                { title: "Real-Time Results", desc: "Pro users see trade-ups the moment they're discovered. Claim a trade-up to lock listings for 30 minutes while you buy.", icon: "⚡" }
              ].map((item, i) => (
                <Card key={i} className="p-8 group hover:ring-[hsl(var(--surface-border-hover))] transition-all">
                  <div className="text-3xl mb-4">{item.icon}</div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-[hsl(var(--text-secondary))] leading-relaxed">{item.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Rarity Tiers */}
        <section className="py-24 bg-[hsl(var(--surface)/0.2)]">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl font-bold mb-4">All Rarity Tiers Covered</h2>
            <p className="text-[hsl(var(--text-secondary))] mb-12">From cheap Mil-Spec skins to expensive Knife/Glove contracts — we find profits at every price range.</p>
            <div className="space-y-2">
              {[
                { name: "Knife / Gloves", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500", desc: "5 Covert inputs → Knife or Glove" },
                { name: "Classified → Covert", color: "border-pink-500/40 bg-pink-500/10 text-pink-500", desc: "10 Classified inputs → Covert gun" },
                { name: "Restricted → Classified", color: "border-purple-500/40 bg-purple-500/10 text-purple-500", desc: "10 Restricted inputs → Classified" },
                { name: "Mil-Spec → Restricted", color: "border-blue-500/40 bg-blue-500/10 text-blue-500", desc: "10 Mil-Spec inputs → Restricted" },
                { name: "Industrial → Mil-Spec", color: "border-sky-400/40 bg-sky-400/10 text-sky-400", desc: "10 Industrial inputs → Mil-Spec" },
              ].map((tier, i) => (
                <div key={i} className={`flex items-center justify-between p-4 rounded-lg border ${tier.color} transition-all`}>
                  <span className="font-bold text-sm">{tier.name}</span>
                  <span className="text-sm opacity-70">{tier.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 border-t border-[hsl(var(--surface-ring))]">
          <div className="mx-auto max-w-7xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-4">Simple Pricing</h2>
              <p className="text-[hsl(var(--text-secondary))]">Start free. Upgrade when you're ready to act on the data.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <Card className="p-8 flex flex-col">
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-[hsl(var(--text-secondary))]">Free</h3>
                  <div className="text-4xl font-bold mt-2">$0</div>
                  <p className="text-[hsl(var(--text-muted))] text-sm mt-2">See what's possible</p>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> 10 sample trade-ups per tier</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Full outcome & input details</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Sort by profit, ROI, chance</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><IconX /> No listing links</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><IconX /> No filters or pagination</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><IconX /> No claim system</li>
                </ul>
                <Button variant="outline" onClick={() => window.location.href = '/auth/steam'} className="w-full">Get Started</Button>
              </Card>

              <Card className="p-8 flex flex-col">
                <div className="mb-8">
                  <h3 className="text-lg font-bold">Basic</h3>
                  <div className="text-4xl font-bold mt-2">$5<span className="text-sm text-[hsl(var(--text-muted))]">/mo</span></div>
                  <p className="text-[hsl(var(--text-secondary))] text-sm mt-2">For active traders</p>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Unlimited trade-ups</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> 30-minute delay on new finds</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Full filters, search, pagination</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Direct listing links</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Verify listing availability</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><IconX /> No claim system</li>
                </ul>
                <Button variant="outline" onClick={() => window.location.href = '/auth/steam'} className="w-full">Subscribe</Button>
              </Card>

              <Card highlighted className="p-8 flex flex-col">
                <div className="absolute top-0 right-0 bg-[hsl(var(--cta))] text-[hsl(var(--cta-foreground))] text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-widest">Best Value</div>
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-[hsl(var(--cta))]">Pro</h3>
                  <div className="text-4xl font-bold mt-2">$15<span className="text-sm text-[hsl(var(--text-muted))]">/mo</span></div>
                  <p className="text-[hsl(var(--text-secondary))] text-sm mt-2">For serious flippers</p>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Everything in Basic</li>
                  <li className="flex items-center gap-3 text-sm font-medium text-[hsl(var(--text-secondary))]"><IconCheck /> Real-time data (no delay)</li>
                  <li className="flex items-center gap-3 text-sm font-medium text-[hsl(var(--text-secondary))]"><IconCheck /> Claim system (lock listings 30 min)</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Up to 5 active claims</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Collection browser & data viewer</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Skin price analytics</li>
                </ul>
                <Button onClick={() => window.location.href = '/auth/steam'} className="w-full">Go Pro</Button>
              </Card>
            </div>
          </div>
        </section>

        {/* Claim System */}
        <section className="py-24 bg-[hsl(var(--surface)/0.2)]">
          <div className="mx-auto max-w-5xl px-6">
            <Card className="p-12 text-center overflow-visible">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl font-bold mb-4">The Claim System</h2>
                <p className="text-[hsl(var(--text-secondary))] mb-12">Pro users can lock a trade-up for 30 minutes. While claimed, other users see it's taken — giving you time to buy the listings without competition.</p>

                <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative">
                  {[
                    { label: "Find", icon: "🔍" },
                    { label: "Claim", icon: "🔒" },
                    { label: "Buy", icon: "🛒" },
                    { label: "Profit", icon: "📈" }
                  ].map((step, i) => (
                    <React.Fragment key={i}>
                      <div className="flex flex-col items-center gap-3 z-10">
                        <div className="h-16 w-16 rounded-full bg-background ring-1 ring-[hsl(var(--surface-ring))] flex items-center justify-center text-2xl shadow-lg">
                          {step.icon}
                        </div>
                        <span className="text-sm font-bold text-[hsl(var(--text-secondary))] uppercase tracking-widest">{step.label}</span>
                      </div>
                      {i < 3 && (
                        <div className="hidden md:block text-[hsl(var(--text-muted))]">
                          <IconArrowRight />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                  <div className="absolute top-8 left-0 w-full h-px bg-gradient-to-r from-transparent via-[hsl(var(--surface-hover))] to-transparent -z-0 hidden md:block" />
                </div>
              </div>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-[hsl(var(--surface-ring))]">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 font-bold tracking-tight text-[hsl(var(--text-secondary))]">
            <div className="h-5 w-5 rounded bg-[hsl(var(--surface-hover))] flex items-center justify-center text-[8px]">TB</div>
            TradeUpBot © 2026
          </div>
          <div className="flex items-center gap-8 text-sm text-[hsl(var(--text-muted))]">
            <a href="/auth/steam" className="hover:text-foreground transition-colors">Steam Login</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export { LandingPage };
