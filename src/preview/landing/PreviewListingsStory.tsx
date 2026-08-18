import { useEffect, useMemo, useState } from "react";
import type { TradeUp } from "../../../shared/types.js";
import {
  collectPreviewSkinNames,
  groupInputSkins,
  rarityForTradeUpRole,
  uniqueOutcomes,
} from "../../../shared/preview-board.js";
import { listingUrl, sourceLabel } from "../../utils/format.js";
import { useCurrency } from "../../contexts/CurrencyContext.js";
import { useSkinImages } from "../../hooks/useSkinImages.js";
import { hydrateTradeUpsFromFaces } from "../board/usePreviewContracts.js";
import { PreviewSkinTile } from "../tiles/PreviewSkinTile.js";

type Phase = "listings" | "inputs" | "output";

export function PreviewListingsStory() {
  const { formatPrice } = useCurrency();
  const [tu, setTu] = useState<TradeUp | null>(null);
  const [phase, setPhase] = useState<Phase>("listings");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const res = await fetch("/api/trade-ups?per_page=1&sort=trade_up_score&order=desc", {
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = await res.json() as { trade_ups?: TradeUp[] };
      const [first] = await hydrateTradeUpsFromFaces(data.trade_ups ?? [], controller.signal);
      if (!first) return;
      if (!first.inputs?.length) {
        const inputsRes = await fetch(`/api/trade-up/${first.id}/inputs`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (inputsRes.ok) {
          const body = await inputsRes.json() as { inputs?: TradeUp["inputs"] };
          first.inputs = body.inputs ?? [];
        }
      }
      setTu(first);
    })().catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!tu) return;
    const order: Phase[] = ["listings", "inputs", "output"];
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % order.length;
      setPhase(order[i]);
    }, 2200);
    return () => window.clearInterval(id);
  }, [tu]);

  const images = useSkinImages(useMemo(() => (tu ? collectPreviewSkinNames([tu]) : []), [tu]));
  if (!tu) return null;

  const inputs = groupInputSkins(tu);
  const outputs = uniqueOutcomes(tu.outcomes);
  const inputRarity = rarityForTradeUpRole(tu.type, "input");
  const outputRarity = rarityForTradeUpRole(tu.type, "output");

  return (
    <section className="pv-story" data-phase={phase} aria-label="Live listings becoming a trade-up">
      <div className="pv-kicker">Live listings</div>
      <h2>What you see is what you pay</h2>
      <p className="pv-muted">
        Each input is a buyable row on CSFloat, DMarket, Skinport, or Buff.market. Ten skins in, one skin out.
      </p>

      <div className={`pv-story-listings${phase === "listings" ? " pv-story-on" : ""}`}>
        {tu.inputs.map(input => (
          <a
            key={input.listing_id}
            className="pv-listing-row"
            href={listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value, input.price_cents, input.source, input.marketplace_id, input.stattrak)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="pv-src">{sourceLabel(input.source)}</span>
            <span>{input.skin_name}</span>
            <span className="pv-tabular">{formatPrice(input.price_cents)}</span>
          </a>
        ))}
      </div>

      <div className={`pv-story-inputs${phase !== "listings" ? " pv-story-on" : ""}`}>
        <div className="pv-tile-row">
          {inputs.map(skin => (
            <PreviewSkinTile
              key={skin.name}
              name={skin.name}
              url={images.get(skin.name)}
              badge={`×${skin.count}`}
              rarity={inputRarity}
              size="in"
            />
          ))}
        </div>
      </div>

      <div className={`pv-story-output${phase === "output" ? " pv-story-on" : ""}`}>
        <div className="pv-kicker">Output</div>
        <div className="pv-tile-row">
          {outputs.map(outcome => (
            <PreviewSkinTile
              key={outcome.skin_id + outcome.skin_name}
              name={outcome.skin_name}
              url={images.get(outcome.skin_name)}
              badge={`${(outcome.probability * 100).toFixed(0)}%`}
              rarity={outputRarity}
              size="out"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
