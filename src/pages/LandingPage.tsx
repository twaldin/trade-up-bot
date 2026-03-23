import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { DemoAnimation } from '../components/DemoAnimation.js';
import { DemoAnimationMobile } from '../components/DemoAnimationMobile.js';
import { SiteNav } from '../components/SiteNav.js';
import { blogPosts } from '../data/blog-posts.js';

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
  total_cycles: number;
  uptime_ms: number;
}

interface LandingUser {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: string;
}

const LandingPage = ({ user }: { user?: LandingUser | null }) => {
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch("/api/global-stats").then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const login = () => { window.location.href = '/auth/steam'; };
  const goToDashboard = () => { window.location.href = '/dashboard'; };
  const logout = () => { window.location.href = '/auth/logout'; };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Helmet>
        <title>TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings</title>
        <meta name="description" content="Real-time CS2 trade-up contract analyzer. Find profitable trade-ups across all rarity tiers using actual marketplace listings from CSFloat, DMarket, and Skinport." />
        <link rel="canonical" href="https://tradeupbot.app/" />
        <meta property="og:title" content="TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings" />
        <meta property="og:description" content="Find profitable CS2 trade-ups built from real, buyable listings. Verify availability and claim before anyone else." />
        <meta property="og:url" content="https://tradeupbot.app/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://tradeupbot.app/tradeuptable.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings" />
        <meta name="twitter:description" content="Find profitable CS2 trade-ups built from real, buyable listings. Verify availability and claim before anyone else." />
        <meta name="twitter:image" content="https://tradeupbot.app/tradeuptable.png" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              "name": "TradeUpBot",
              "url": "https://tradeupbot.app",
              "description": "Real-time CS2 trade-up contract analyzer. Find profitable trade-ups from real marketplace listings.",
              "potentialAction": {
                "@type": "SearchAction",
                "target": "https://tradeupbot.app/data?search={search_term_string}",
                "query-input": "required name=search_term_string"
              }
            },
            {
              "@type": "Organization",
              "name": "TradeUpBot",
              "url": "https://tradeupbot.app",
              "logo": "https://tradeupbot.app/favicon.svg",
              "description": "CS2 trade-up contract analysis platform using real marketplace data from CSFloat, DMarket, and Skinport."
            }
          ]
        })}</script>
      </Helmet>

      <SiteNav centerLinks={[
        { href: "#features", label: "Features" },
        { href: "#pricing", label: "Pricing" },
        { href: "#faq", label: "FAQ" },
        { href: "#blog", label: "Blog" },
      ]} />

      <main>
        {/* Hero */}
        <section className="pt-28 pb-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-3xl mb-12">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-5 leading-[1.1]">
                CS2 trade-ups built from<br />real, buyable listings
              </h1>
              <p className="text-lg text-muted-foreground mb-4 max-w-xl">
                Other tools show theoretical trade-ups with idealized floats and average prices. We build contracts from actual marketplace listings you can buy right now.
              </p>
              <p className="text-sm text-muted-foreground/70 mb-8 max-w-xl">
                Every trade-up on TradeUpBot links to specific listings on CSFloat, DMarket, and Skinport — with exact floats, exact prices, and deterministic outcomes. No guesswork.
              </p>
              <div className="flex items-center gap-4">
                {user ? (
                  <Btn onClick={goToDashboard} className="px-6 py-3">
                    Go to Dashboard
                  </Btn>
                ) : (
                  <>
                    <Btn onClick={login} className="px-6 py-3">
                      <IconSteam /> Sign in with Steam
                    </Btn>
                    <span className="text-xs text-muted-foreground">Free to start</span>
                  </>
                )}
              </div>
            </div>

            {/* Stats */}
            {stats && (
              <div className="flex gap-8 mb-12 text-sm">
                <div><span className="text-foreground font-semibold tabular-nums">{stats.total_trade_ups.toLocaleString()}</span> <span className="text-muted-foreground">trade-ups</span></div>
                <div><span className="text-green-500 font-semibold tabular-nums">{stats.profitable_trade_ups.toLocaleString()}</span> <span className="text-muted-foreground">profitable</span></div>
                <div><span className="text-foreground font-semibold tabular-nums">{stats.total_data_points.toLocaleString()}</span> <span className="text-muted-foreground">data points</span></div>
                {stats.total_cycles > 0 && (() => {
                  const totalMinutes = stats.total_cycles * 20;
                  const hours = Math.floor(totalMinutes / 60);
                  const time = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
                  return <div><span className="text-foreground font-semibold tabular-nums">{time}</span> <span className="text-muted-foreground">analyzed</span></div>;
                })()}
              </div>
            )}

            {/* Interactive Demo */}
            <div className="hidden md:block">
              <DemoAnimation />
            </div>
            <div className="md:hidden">
              <DemoAnimationMobile />
            </div>
          </div>
        </section>

        {/* Value prop */}
        <section className="py-20 border-t border-border">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">What you see is what you pay</h2>
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Every trade-up on TradeUpBot is built from real marketplace listings — not theoretical calculations with idealized floats. Click any input to buy it directly.
            </p>
            <div className="grid sm:grid-cols-3 gap-6 text-left">
              <div className="border border-border rounded-lg p-5">
                <div className="text-green-500 text-sm font-semibold mb-2">Real listings</div>
                <p className="text-sm text-muted-foreground">Every input links to an actual listing on CSFloat, DMarket, or Skinport that you can purchase right now.</p>
              </div>
              <div className="border border-border rounded-lg p-5">
                <div className="text-green-500 text-sm font-semibold mb-2">Verify before buying</div>
                <p className="text-sm text-muted-foreground">One-click verification checks if all inputs are still listed and at what price. No surprises at checkout.</p>
              </div>
              <div className="border border-border rounded-lg p-5">
                <div className="text-green-500 text-sm font-semibold mb-2">Claim to lock</div>
                <p className="text-sm text-muted-foreground">Pro users can claim a trade-up for 30 minutes, hiding the listings from other users while you buy.</p>
              </div>
            </div>
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
            <div className="text-center mt-10">
              <a href="/features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                See all features &rarr;
              </a>
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
            <p className="text-muted-foreground text-center mb-10">From cheap Consumer skins to Knife/Glove contracts.</p>
            <div className="space-y-2">
              {[
                { name: "Knife / Gloves", cls: "border-yellow-500/30 text-yellow-500", desc: "5 Covert → Knife or Glove" },
                { name: "Covert", cls: "border-red-500/30 text-red-500", desc: "10 Classified → Covert" },
                { name: "Classified", cls: "border-pink-500/30 text-pink-500", desc: "10 Restricted → Classified" },
                { name: "Restricted", cls: "border-purple-500/30 text-purple-500", desc: "10 Mil-Spec → Restricted" },
                { name: "Mil-Spec", cls: "border-blue-500/30 text-blue-500", desc: "10 Industrial → Mil-Spec" },
                { name: "Industrial", cls: "border-sky-400/30 text-sky-400", desc: "10 Consumer → Industrial" },
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
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Unlimited trade-ups</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Full filters & search</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Listing links</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 3-hour data delay</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Collection browser</li>
                  <li className="flex items-center gap-2 text-muted-foreground/40"><IconX /> No verification</li>
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
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Everything in Free</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> 30-min delay on new finds</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Verify availability (10/hr)</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Claims (5/day)</li>
                  <li className="flex items-center gap-2 text-muted-foreground"><IconCheck /> Up to 5 active claims</li>
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
                </ul>
                <Btn onClick={login} className="w-full">Go Pro</Btn>
              </div>
            </div>
            <div className="text-center mt-8">
              <a href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Compare all plans &rarr;
              </a>
            </div>
          </div>
        </section>
        {/* Blog */}
        <section id="blog" className="py-20 border-t border-border">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="text-2xl font-bold mb-3 text-center">Blog</h2>
            <p className="text-muted-foreground text-center mb-10">Guides, strategies, and updates from the TradeUpBot team.</p>
            <div className="grid sm:grid-cols-3 gap-6">
              {blogPosts.slice(0, 3).map((post) => (
                <a key={post.slug} href={`/blog/${post.slug}`} className="border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors block">
                  <div className="text-xs text-muted-foreground/50 mb-2">{new Date(post.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                  <h3 className="font-semibold text-sm mb-2">{post.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{post.excerpt}</p>
                </a>
              ))}
            </div>
            <div className="text-center mt-8">
              <a href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                View all posts &rarr;
              </a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-20 border-t border-border">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-2xl font-bold mb-10 text-center">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {[
                { q: "How does TradeUpBot find profitable trade-ups?", a: "We continuously scan CSFloat, DMarket, and Skinport for real listings, then test thousands of input combinations across 45+ float targets. Every trade-up is built from actual buyable listings — not theoretical calculations." },
                { q: "How accurate are the prices?", a: "Prices come from real marketplace data: CSFloat sale history (primary), DMarket listing floors, and Skinport prices. All prices are estimates — actual prices may differ at time of purchase, especially after trade lock periods." },
                { q: "Can I lose money on a trade-up?", a: "Yes. All prices are estimates based on current market data. Items purchased from marketplaces have trade lock periods during which prices can change. \"Profitable\" means profitable at current estimated prices, not guaranteed profit." },
                { q: "What does Verify do?", a: "Verify checks if all input listings still exist on the marketplace and at what price. It updates the trade-up stats in real time so you know exactly what you're buying before you commit." },
                { q: "What does Claim do?", a: "Pro users can claim a trade-up to lock its listings for 30 minutes. While claimed, those listings are hidden from other users so no one can buy them while you're purchasing." },
              ].map((item, i) => (
                <details key={i} className="group border border-border rounded-lg">
                  <summary className="flex items-center justify-between cursor-pointer px-5 py-4 text-sm font-medium select-none">
                    {item.q}
                    <span className="text-muted-foreground group-open:rotate-45 transition-transform text-lg">+</span>
                  </summary>
                  <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
            <div className="text-center mt-6">
              <a href="/faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                See full FAQ &rarr;
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-10 border-t border-border">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="font-bold text-sm mb-3">TradeUpBot</div>
              <p className="text-xs text-muted-foreground leading-relaxed">CS2 trade-up contract analyzer built from real marketplace listings.</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-3">Product</div>
              <div className="space-y-2 text-sm">
                <a href="#features" className="block text-muted-foreground hover:text-foreground transition-colors">Features</a>
                <a href="#pricing" className="block text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
                <a href="#faq" className="block text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
                <a href="/blog" className="block text-muted-foreground hover:text-foreground transition-colors">Blog</a>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-3">Legal</div>
              <div className="space-y-2 text-sm">
                <a href="/terms" className="block text-muted-foreground hover:text-foreground transition-colors">Terms of Service</a>
                <a href="/privacy" className="block text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</a>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-3">Contact</div>
              <div className="space-y-2 text-sm">
                <a href="https://discord.gg/tradeupbot" target="_blank" rel="noopener noreferrer" className="block text-muted-foreground hover:text-foreground transition-colors">Discord</a>
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-6 text-center text-xs text-muted-foreground/50">
            TradeUpBot is not affiliated with Valve Corporation. CS2 and Counter-Strike are trademarks of Valve Corporation.
          </div>
        </div>
      </footer>
    </div>
  );
};

export { LandingPage };
