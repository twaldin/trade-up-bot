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

const LandingPage = () => {
  
  const [stats, setStats] = useState({ knives: 912, classified: 1044, total: 10231 });

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(prev => ({
        knives: prev.knives + (Math.random() > 0.8 ? 1 : 0),
        classified: prev.classified + (Math.random() > 0.8 ? 2 : 0),
        total: prev.total + (Math.random() > 0.8 ? 5 : 0)
      }));
    }, 5000);
    return () => clearInterval(interval);
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
            <a href="#tiers" className="hover:text-foreground transition-colors">Tiers</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <Button onClick={() => window.location.href = '/auth/steam'} className="h-9 px-4">
            <IconSteam /> Sign In
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
              Live Market Analysis Active
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
              Find Profitable CS2 Trade-Ups <br className="hidden sm:block" />
              <span className="text-[hsl(var(--text-muted))]">Before Anyone Else</span>
            </h1>

            <p className="mx-auto max-w-2xl text-lg text-[hsl(var(--text-secondary))] mb-10">
              Real-time market intelligence across CSFloat, DMarket, and Skinport.
              Our engine evaluates thousands of combinations every 10 minutes to find the gaps in the market.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <Button onClick={() => window.location.href = '/auth/steam'} className="w-full sm:w-auto px-8 py-4 text-base">
                <IconSteam /> Sign in with Steam
              </Button>
              <Button variant="outline" onClick={() => window.location.href = '/demo'} className="w-full sm:w-auto px-8 py-4 text-base">
                View Demo
              </Button>
            </div>

            {/* Mock Screenshot */}
            <div className="relative mx-auto max-w-5xl group">
              <div className="absolute -inset-1 bg-gradient-to-b from-[hsl(var(--cta)/0.2)] to-transparent rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000" />
              <Card className="p-1 bg-[hsl(var(--surface-hover))]">
                <div className="rounded-xl bg-[hsl(var(--background))] overflow-hidden border border-[hsl(var(--surface-ring))]">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--surface-ring))] bg-[hsl(var(--surface))]">
                    <div className="flex gap-1.5">
                      <div className="h-3 w-3 rounded-full bg-[hsl(var(--surface-hover))]" />
                      <div className="h-3 w-3 rounded-full bg-[hsl(var(--surface-hover))]" />
                      <div className="h-3 w-3 rounded-full bg-[hsl(var(--surface-hover))]" />
                    </div>
                    <div className="mx-auto text-[10px] text-[hsl(var(--text-muted))] font-mono tracking-widest uppercase">Live Dashboard — Profitable Leads</div>
                  </div>
                  <div className="p-6 space-y-4 opacity-60 grayscale-[0.5] blur-[1px]">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center justify-between py-3 border-b border-[hsl(var(--surface-ring))] last:border-0">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded bg-[hsl(var(--surface-hover))]" />
                          <div className="text-left">
                            <div className="h-3 w-32 bg-[hsl(var(--surface-hover))] rounded mb-2" />
                            <div className="h-2 w-20 bg-[hsl(var(--surface))] rounded" />
                          </div>
                        </div>
                        <div className="flex gap-8">
                          <div className="text-right">
                            <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase mb-1">Cost</div>
                            <div className="h-3 w-12 bg-[hsl(var(--surface-hover))] rounded ml-auto" />
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase mb-1">Profit</div>
                            <div className="text-[hsl(var(--profit))] font-mono text-sm">+$142.50</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how" className="py-24 border-t border-[hsl(var(--surface-ring))]">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { title: "Market Scanning", desc: "We pull thousands of listings every minute from CSFloat, DMarket, and Skinport.", icon: "📡" },
                { title: "Smart Discovery", desc: "Algorithms evaluate every collection combo at 45+ specific float targets.", icon: "🧠" },
                { title: "Profit Alerts", desc: "Get notified the second high-value opportunities appear before the market adjusts.", icon: "🔔" }
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

        {/* Live Stats */}
        <section className="py-24 bg-[hsl(var(--surface)/0.2)]">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { label: "Knife Trade-Ups", value: stats.knives, suffix: "+" },
                { label: "Classified Leads", value: stats.classified, suffix: "+" },
                { label: "Price Observations", value: stats.total, suffix: "K" },
                { label: "Update Frequency", value: 10, suffix: "m" }
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <div className="text-[hsl(var(--text-muted))] text-xs font-bold uppercase tracking-widest mb-2">{stat.label}</div>
                  <div className="text-4xl font-bold tabular-nums text-foreground">
                    {stat.value.toLocaleString()}{stat.suffix}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trade-Up Types */}
        <section id="tiers" className="py-24">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl font-bold mb-12">The Rarity Ladder</h2>
            <div className="space-y-2">
              {[
                { name: "Knife / Gloves", color: "bg-[hsl(var(--tier-knife))]", profit: "$200 - $1,500+", width: "w-full" },
                { name: "Covert", color: "bg-[hsl(var(--tier-covert))]", profit: "$40 - $300", width: "w-[90%]" },
                { name: "Classified", color: "bg-[hsl(var(--tier-classified))]", profit: "$15 - $80", width: "w-[80%]" },
                { name: "Restricted", color: "bg-[hsl(var(--tier-restricted))]", profit: "$5 - $25", width: "w-[70%]" },
                { name: "Mil-Spec", color: "bg-[hsl(var(--tier-milspec))]", profit: "$1 - $10", width: "w-[60%]" },
                { name: "Industrial", color: "bg-[hsl(var(--tier-industrial))]", profit: "$0.10 - $2", width: "w-[50%]" },
              ].map((tier, i) => (
                <div key={i} className="flex justify-center">
                  <div className={`${tier.width} flex items-center justify-between p-4 rounded-lg bg-[hsl(var(--surface))] ring-1 ring-[hsl(var(--surface-ring))] hover:ring-[hsl(var(--surface-border-hover))] transition-all`}>
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${tier.color}`} />
                      <span className="font-bold text-sm uppercase tracking-wide">{tier.name}</span>
                    </div>
                    <span className="text-[hsl(var(--profit))] font-mono text-sm">{tier.profit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 border-t border-[hsl(var(--surface-ring))]">
          <div className="mx-auto max-w-7xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-4">Choose Your Intelligence</h2>
              <p className="text-[hsl(var(--text-secondary))]">Scale your trading with data that moves at your speed.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="p-8 flex flex-col">
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-[hsl(var(--text-secondary))]">Free</h3>
                  <div className="text-4xl font-bold mt-2">$0</div>
                  <p className="text-[hsl(var(--text-muted))] text-sm mt-2">For curious traders</p>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> 10 results per scan</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> 30-minute delay</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><s>Direct listing links</s></li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><s>Claim system</s></li>
                </ul>
                <Button variant="outline" className="w-full">Get Started</Button>
              </Card>

              <Card className="p-8 flex flex-col">
                <div className="mb-8">
                  <h3 className="text-lg font-bold">Basic</h3>
                  <div className="text-4xl font-bold mt-2">$5<span className="text-sm text-[hsl(var(--text-muted))]">/mo</span></div>
                  <p className="text-[hsl(var(--text-secondary))] text-sm mt-2">For active hobbyists</p>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Unlimited results</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> 5-minute delay</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Full listing links</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-muted))]"><s>Claim system</s></li>
                </ul>
                <Button variant="outline" className="w-full">Subscribe</Button>
              </Card>

              <Card highlighted className="p-8 flex flex-col">
                <div className="absolute top-0 right-0 bg-[hsl(var(--cta))] text-[hsl(var(--cta-foreground))] text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-widest">Recommended</div>
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-[hsl(var(--cta))]">Pro</h3>
                  <div className="text-4xl font-bold mt-2">$15<span className="text-sm text-[hsl(var(--text-muted))]">/mo</span></div>
                  <p className="text-[hsl(var(--text-secondary))] text-sm mt-2">For professional flippers</p>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Real-time data</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Claim System access</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Discord & API Alerts</li>
                  <li className="flex items-center gap-3 text-sm text-[hsl(var(--text-secondary))]"><IconCheck /> Priority support</li>
                </ul>
                <Button className="w-full">Go Pro</Button>
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
                <p className="text-[hsl(var(--text-secondary))] mb-12">Pro users can lock a trade-up for 30 minutes. While claimed, no other user can see the specific listings, giving you time to buy safely.</p>

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
            <a href="https://github.com/twaldin/trade-up-bot" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="#" className="hover:text-foreground transition-colors">Discord</a>
            <a href="/auth/steam" className="hover:text-foreground transition-colors">Steam Login</a>
          </div>
          <div className="text-xs text-[hsl(var(--text-muted))] font-mono">v2.4.0-stable</div>
        </div>
      </footer>
    </div>
  );
};

export { LandingPage };
