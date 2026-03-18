import { Link } from "react-router-dom";

export function SiteFooter() {
  return (
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
              <Link to="/" className="block text-muted-foreground hover:text-foreground transition-colors">Home</Link>
              <Link to="/features" className="block text-muted-foreground hover:text-foreground transition-colors">Features</Link>
              <Link to="/pricing" className="block text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="/faq" className="block text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
              <Link to="/blog" className="block text-muted-foreground hover:text-foreground transition-colors">Blog</Link>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-3">Legal</div>
            <div className="space-y-2 text-sm">
              <Link to="/terms" className="block text-muted-foreground hover:text-foreground transition-colors">Terms of Service</Link>
              <Link to="/privacy" className="block text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>
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
  );
}
