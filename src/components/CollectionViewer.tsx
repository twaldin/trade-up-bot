import { useState, useEffect } from "react";
import { formatDollars } from "../utils/format.js";
import { DataViewer } from "./DataViewer.js";

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
    <div className="data-viewer">
      <div className="dv-collection-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2>{collectionName}</h2>
      </div>

      {loading ? <div className="loading-text">Loading...</div> : (
        <>
          {/* Trade-up summary */}
          <div className="dv-stats-bar">
            <span>{tradeUps.length} trade-ups</span>
            <span style={{ color: "#22c55e" }}>{profitable.length} profitable</span>
            {profitable.length > 0 && (
              <span>Best: {formatDollars(Math.max(...profitable.map(t => t.profit_cents)))}</span>
            )}
          </div>

          {/* Knife/Glove Pool */}
          {knifePool && (knifePool.knifeTypes.length > 0 || knifePool.gloveTypes.length > 0) && (
            <div className="collection-section">
              <h3>Output Pool</h3>
              <div className="knife-pool">
                {knifePool.knifeTypes.length > 0 && (
                  <div className="knife-pool-group">
                    <span className="knife-pool-label">Knives</span>
                    <div className="knife-pool-items">
                      {knifePool.knifeTypes.map(k => (
                        <span key={k} className="knife-pool-chip knife-chip">{k}</span>
                      ))}
                    </div>
                    {knifePool.finishCount > 0 && (
                      <span className="knife-pool-detail">
                        {knifePool.knifeTypes.length} types × {knifePool.finishCount} finishes = {knifePool.knifeTypes.length * knifePool.finishCount} possible outputs
                      </span>
                    )}
                  </div>
                )}
                {knifePool.gloveTypes.length > 0 && (
                  <div className="knife-pool-group">
                    <span className="knife-pool-label">Gloves</span>
                    <div className="knife-pool-items">
                      {knifePool.gloveTypes.map(g => (
                        <span key={g} className="knife-pool-chip glove-chip">{g}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!knifePool && (
            <div className="collection-section">
              <div className="knife-pool-empty">No knife/glove pool — this collection is not associated with a case</div>
            </div>
          )}

          {/* Theory tracking for this collection */}
          {theories.length > 0 && (
            <div className="collection-section">
              <h3>Theory Tracking</h3>
              <div className="collection-theories">
                {theories.map((t, i) => (
                  <div key={i} className={`theory-row theory-${t.status}`}>
                    <span className="theory-combo">{t.combo_key}</span>
                    <span className={`theory-status theory-status-${t.status}`}>{t.status}</span>
                    {t.gap_cents != null && <span className="theory-gap">{t.gap_cents > 0 ? "+" : ""}{formatDollars(t.gap_cents)}</span>}
                    {t.cooldown_until && <span className="theory-cooldown">until {new Date(t.cooldown_until).toLocaleString()}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top trade-ups */}
          {tradeUps.length > 0 && (
            <div className="collection-section">
              <h3>Trade-Ups ({tradeUps.length})</h3>
              <div className="collection-tradeups">
                {tradeUps.slice(0, 20).map((t: any) => (
                  <div key={t.id} className={`tradeup-row ${t.profit_cents > 0 ? "tradeup-profitable" : ""}`}>
                    <span className={`tradeup-profit ${t.profit_cents > 0 ? "profit-positive" : "profit-negative"}`}>
                      {t.profit_cents > 0 ? "+" : ""}{formatDollars(t.profit_cents)}
                    </span>
                    <span className="tradeup-roi">{t.roi_percentage.toFixed(1)}% ROI</span>
                    <span className="tradeup-cost">Cost: {formatDollars(t.total_cost_cents)}</span>
                    <span className="tradeup-ev">EV: {formatDollars(t.expected_value_cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skins browser with Inputs/Outputs toggle */}
          <div className="collection-section">
            <div className="dv-rarity-tabs" style={{ marginBottom: 8 }}>
              <button className={skinView === "inputs" ? "toggle-active" : ""} onClick={() => setSkinView("inputs")}>
                Inputs
              </button>
              {knifePool && (knifePool.knifeTypes.length > 0 || knifePool.gloveTypes.length > 0) && (
                <button className={skinView === "outputs" ? "toggle-active" : ""} onClick={() => setSkinView("outputs")}>
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
