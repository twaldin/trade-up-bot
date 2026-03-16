import { useState, useEffect } from "react";
import { formatDollars } from "../utils/format.js";

interface ArbitrageOpp {
  skinName: string;
  rarity: string;
  condition: string;
  buyMarketplace: string;
  buyPrice: number;
  sellMarketplace: string;
  sellPrice: number;
  profitCents: number;
  roiPct: number;
  buyFloat: number;
  salesVolume: number;
}

interface FloatSnipe {
  skinName: string;
  rarity: string;
  marketplace: string;
  listingPrice: number;
  floatValue: number;
  avgConditionPrice: number;
  discountPct: number;
  salesVolume: number;
  listingId: string;
}

export function ScannerPage() {
  const [tab, setTab] = useState<"arbitrage" | "floats">("arbitrage");
  const [arbitrage, setArbitrage] = useState<ArbitrageOpp[]>([]);
  const [snipes, setSnipes] = useState<FloatSnipe[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    if (tab === "arbitrage") {
      fetch("/api/scanner/arbitrage?limit=100")
        .then(r => r.json())
        .then(data => { setArbitrage(data.opportunities || []); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      fetch("/api/scanner/float-snipes?limit=100&maxFloat=0.02")
        .then(r => r.json())
        .then(data => { setSnipes(data.snipes || []); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [tab]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-foreground mb-4">Market Scanner</h1>

      <div className="flex gap-2 mb-4">
        <button
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${tab === "arbitrage" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          onClick={() => setTab("arbitrage")}
        >
          Cross-Market Arbitrage
        </button>
        <button
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${tab === "floats" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          onClick={() => setTab("floats")}
        >
          Low-Float Snipes
        </button>
      </div>

      {loading && <div className="text-muted-foreground animate-pulse py-8 text-center">Scanning...</div>}

      {!loading && tab === "arbitrage" && (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground mb-2">{arbitrage.length} opportunities found (buy DMarket → sell CSFloat)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 px-2">Skin</th>
                <th className="py-2 px-2">Condition</th>
                <th className="py-2 px-2 text-right">Buy (DM)</th>
                <th className="py-2 px-2 text-right">Sell (CF)</th>
                <th className="py-2 px-2 text-right">Profit</th>
                <th className="py-2 px-2 text-right">ROI</th>
                <th className="py-2 px-2 text-right">Sales Vol</th>
              </tr>
            </thead>
            <tbody>
              {arbitrage.map((a, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2">
                    <span className="text-foreground">{a.skinName}</span>
                    <span className="ml-1 text-[0.65rem] text-muted-foreground">{a.rarity}</span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{a.condition}</td>
                  <td className="py-2 px-2 text-right text-red-400">{formatDollars(a.buyPrice)}</td>
                  <td className="py-2 px-2 text-right text-green-400">{formatDollars(a.sellPrice)}</td>
                  <td className="py-2 px-2 text-right font-semibold text-green-500">{formatDollars(a.profitCents)}</td>
                  <td className="py-2 px-2 text-right text-green-400">{a.roiPct.toFixed(0)}%</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{a.salesVolume}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {arbitrage.length === 0 && <div className="text-muted-foreground text-center py-8">No arbitrage opportunities found</div>}
        </div>
      )}

      {!loading && tab === "floats" && (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground mb-2">{snipes.length} low-float snipes found (listed below avg FN price)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 px-2">Skin</th>
                <th className="py-2 px-2 text-right">Float</th>
                <th className="py-2 px-2 text-right">Listed Price</th>
                <th className="py-2 px-2 text-right">Avg FN Sale</th>
                <th className="py-2 px-2 text-right">Discount</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2 text-right">Sales Vol</th>
              </tr>
            </thead>
            <tbody>
              {snipes.map((s, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2">
                    <span className="text-foreground">{s.skinName}</span>
                    <span className="ml-1 text-[0.65rem] text-muted-foreground">{s.rarity}</span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-blue-400">{s.floatValue.toFixed(6)}</td>
                  <td className="py-2 px-2 text-right text-green-400">{formatDollars(s.listingPrice)}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{formatDollars(s.avgConditionPrice)}</td>
                  <td className="py-2 px-2 text-right font-semibold text-green-500">-{s.discountPct}%</td>
                  <td className="py-2 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[0.6rem] font-semibold rounded ${s.marketplace === "dmarket" ? "bg-purple-900 text-purple-300" : "bg-blue-900 text-blue-300"}`}>
                      {s.marketplace === "dmarket" ? "DM" : "CF"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{s.salesVolume}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snipes.length === 0 && <div className="text-muted-foreground text-center py-8">No low-float snipes found</div>}
        </div>
      )}
    </div>
  );
}
