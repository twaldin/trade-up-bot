import { Link } from "react-router-dom";

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="font-bold tracking-tight hover:opacity-80 transition-opacity">
            TradeUpBot
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground mb-10">Last updated: March 2026</p>

          <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">What We Collect</h2>
              <p>
                When you sign in and use TradeUpBot, we collect and store the following information:
              </p>
              <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                <li><strong className="text-foreground">Steam ID</strong> — your unique Steam identifier, received via Steam OpenID authentication</li>
                <li><strong className="text-foreground">Display name</strong> — your public Steam display name</li>
                <li><strong className="text-foreground">Avatar URL</strong> — your public Steam profile avatar</li>
                <li><strong className="text-foreground">Email address</strong> — provided to us by Stripe when you subscribe to a paid plan</li>
                <li><strong className="text-foreground">Subscription status</strong> — your current plan tier and billing status</li>
                <li><strong className="text-foreground">Usage data</strong> — claims, verifications, and feature usage for rate limiting</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">What We Do Not Collect</h2>
              <p>
                TradeUpBot does not collect, store, or have access to:
              </p>
              <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                <li><strong className="text-foreground">Steam password</strong> — authentication is handled entirely by Steam OpenID; we never see your password</li>
                <li><strong className="text-foreground">Steam inventory data</strong> — we do not access or read your Steam inventory</li>
                <li><strong className="text-foreground">Payment card details</strong> — all payment processing is handled by Stripe; card numbers never touch our servers</li>
                <li><strong className="text-foreground">Marketplace credentials</strong> — we do not store your CSFloat, DMarket, or Skinport login details</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Cookies</h2>
              <p>
                TradeUpBot uses a single session cookie for authentication. This cookie identifies
                your login session and is required for the service to function. We do not use
                tracking cookies, advertising cookies, or third-party analytics cookies.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Third-Party Services</h2>
              <p>
                TradeUpBot integrates with the following third-party services:
              </p>
              <div className="mt-3 space-y-3">
                <div className="border border-border rounded-lg p-4">
                  <div className="font-medium text-foreground mb-1">Stripe</div>
                  <p>
                    Payment processing for subscriptions. Stripe receives your payment information
                    directly and shares your email address with us for account management. See
                    Stripe's privacy policy at{" "}
                    <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:opacity-80">
                      stripe.com/privacy
                    </a>.
                  </p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="font-medium text-foreground mb-1">Steam (Valve)</div>
                  <p>
                    Authentication via Steam OpenID. We receive your public Steam ID and display
                    name. See Valve's privacy policy at{" "}
                    <a href="https://store.steampowered.com/privacy_agreement/" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:opacity-80">
                      store.steampowered.com/privacy_agreement
                    </a>.
                  </p>
                </div>
                <div className="border border-border rounded-lg p-4">
                  <div className="font-medium text-foreground mb-1">CSFloat, DMarket, Skinport</div>
                  <p>
                    Market data sources for skin listings and pricing. We fetch public marketplace
                    data from these services. Your TradeUpBot account is not linked to accounts
                    on these platforms.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Data Retention</h2>
              <p>
                Your account data (Steam ID, display name, subscription status) is retained
                for as long as your account is active. If you cancel your subscription, your
                account data remains available should you choose to resubscribe.
              </p>
              <p className="mt-2">
                You may request deletion of all your account data at any time by contacting us
                via Discord. Upon request, we will delete your account information within 30 days.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Data Security</h2>
              <p>
                We implement reasonable security measures to protect your data, including
                encrypted connections (HTTPS), secure session management, and limited data
                retention. However, no method of electronic transmission or storage is 100%
                secure.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Changes to This Policy</h2>
              <p>
                We may update this privacy policy from time to time. Changes will be reflected
                by updating the "Last updated" date at the top of this page. Continued use of
                the service constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
              <p>
                For privacy-related inquiries, data deletion requests, or questions about how
                your information is handled, please reach out via Discord or through the
                platform's support channels.
              </p>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
