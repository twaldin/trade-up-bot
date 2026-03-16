import { useState, useEffect } from "react";
import { formatDollars } from "../utils/format.js";
import { DataViewer } from "./DataViewer.js";
import { Button } from "@shared/components/ui/button.js";
import { Badge } from "@shared/components/ui/badge.js";
import { Card, CardHeader, CardTitle, CardContent } from "@shared/components/ui/card.js";

interface Props {
  collectionName: string;
  onBack: () => void;
  onNavigateCollection: (name: string) => void;
}

export function CollectionViewer({ collectionName, onBack, onNavigateCollection }: Props) {
  const [tradeUps, setTradeUps] = useState<any[]>([]);
  const [theories, setTheories] = useState<any[]>([]);
  const [knifePool, setKnifePool] = useState<{ knifeTypes: string[]; gloveTypes: string[]; finishCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [skinView, setSkinView] = useState<"inputs" | "outputs">("inputs");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/collection/${encodeURIComponent(collectionName)}`)
      .then(r => r.json())
      .then(data => {
        setTradeUps(data.tradeUps || []);
        setTheories(data.theories || []);
        setKnifePool(data.knifePool || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionName]);

  const profitable = tradeUps.filter(t => t.profit_cents > 0);

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-lg font-semibold text-foreground">{collectionName}</h2>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Trade-up summary */}
          <div className="flex gap-5 px-3 py-2 bg-muted/50 border border-border rounded-md text-sm text-muted-foreground mb-3">
            <span className="text-foreground/80">{tradeUps.length} trade-ups</span>
            <span className="text-green-500">{profitable.length} profitable</span>
            {profitable.length > 0 && (
              <span className="text-foreground/80">Best: {formatDollars(Math.max(...profitable.map(t => t.profit_cents)))}</span>
            )}
          </div>

          {/* Knife/Glove Pool */}
          {knifePool && (knifePool.knifeTypes.length > 0 || knifePool.gloveTypes.length > 0) && (
            <Card className="mb-3">
              <CardHeader>
                <CardTitle>Output Pool</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2.5">
                  {knifePool.knifeTypes.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Knives</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {knifePool.knifeTypes.map(k => (
                          <Badge key={k} variant="outline" className="bg-blue-400/10 text-blue-400 border-blue-400/20">
                            {k}
                          </Badge>
                        ))}
                      </div>
                      {knifePool.finishCount > 0 && (
                        <span className="text-[0.7rem] text-muted-foreground">
                          {knifePool.knifeTypes.length} types x {knifePool.finishCount} finishes = {knifePool.knifeTypes.length * knifePool.finishCount} possible outputs
                        </span>
                      )}
                    </div>
                  )}
                  {knifePool.gloveTypes.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gloves</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {knifePool.gloveTypes.map(g => (
                          <Badge key={g} variant="outline" className="bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20">
                            {g}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!knifePool && (
            <div className="px-3 py-2">
              <p className="text-sm text-muted-foreground py-2">No knife/glove pool — this collection is not associated with a case</p>
            </div>
          )}

          {/* Theory tracking for this collection */}
          {theories.length > 0 && (
            <Card className="mb-3">
              <CardHeader>
                <CardTitle>Theory Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1">
                  {theories.map((t, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 items-center px-2 py-1 bg-muted/50 rounded text-xs border-l-[3px] ${
                        t.status === "profitable" ? "border-l-green-500"
                        : t.status === "near_miss" ? "border-l-yellow-500"
                        : t.status === "invalidated" ? "border-l-red-500"
                        : "border-l-border"
                      }`}
                    >
                      <span className="text-foreground/80 flex-1">{t.combo_key}</span>
                      <span className={
                        t.status === "profitable" ? "text-green-500"
                        : t.status === "near_miss" ? "text-yellow-500"
                        : t.status === "invalidated" ? "text-red-500"
                        : "text-muted-foreground"
                      }>
                        {t.status}
                      </span>
                      {t.gap_cents != null && (
                        <span className="text-muted-foreground">{t.gap_cents > 0 ? "+" : ""}{formatDollars(t.gap_cents)}</span>
                      )}
                      {t.cooldown_until && (
                        <span className="text-muted-foreground/60 text-[0.65rem]">until {new Date(t.cooldown_until).toLocaleString()}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top trade-ups */}
          {tradeUps.length > 0 && (
            <Card className="mb-3">
              <CardHeader>
                <CardTitle>Trade-Ups ({tradeUps.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-0.5">
                  {tradeUps.slice(0, 20).map((t: any) => (
                    <div
                      key={t.id}
                      className={`flex gap-3 items-center px-2 py-1 bg-muted/50 rounded text-xs border-l-[3px] ${
                        t.profit_cents > 0 ? "border-l-green-500" : "border-l-border"
                      }`}
                    >
                      <span className={`font-semibold ${t.profit_cents > 0 ? "text-green-500" : "text-red-500"}`}>
                        {t.profit_cents > 0 ? "+" : ""}{formatDollars(t.profit_cents)}
                      </span>
                      <span className="text-muted-foreground">{t.roi_percentage.toFixed(1)}% ROI</span>
                      <span className="text-muted-foreground">Cost: {formatDollars(t.total_cost_cents)}</span>
                      <span className="text-blue-400">EV: {formatDollars(t.expected_value_cents)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skins browser with Inputs/Outputs toggle */}
          <div className="px-3 py-2">
            <div className="flex gap-0 mb-2 w-fit">
              <button
                className={`px-5 py-2 text-sm border border-border transition-colors cursor-pointer rounded-l-md ${
                  skinView === "inputs"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => setSkinView("inputs")}
              >
                Inputs
              </button>
              {knifePool && (knifePool.knifeTypes.length > 0 || knifePool.gloveTypes.length > 0) && (
                <button
                  className={`px-5 py-2 text-sm border border-border border-l-0 transition-colors cursor-pointer rounded-r-md ${
                    skinView === "outputs"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setSkinView("outputs")}
                >
                  Outputs
                </button>
              )}
            </div>
            {skinView === "inputs" ? (
              <DataViewer onNavigateCollection={onNavigateCollection} collectionFilter={collectionName} />
            ) : (
              <DataViewer onNavigateCollection={onNavigateCollection} outputCollection={collectionName} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
