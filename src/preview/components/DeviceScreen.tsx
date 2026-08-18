import { useMemo, useState } from "react";
import type { Condition, TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { TradeUpCard, useFaces } from "../pages/PreviewBoard.js";

/**
 * A labelled example board for the marketing device frames. Structurally the
 * real card — same outcome math, same components — never an invented series.
 */

function listing(
  skinName: string,
  priceCents: number,
  condition: Condition,
  source: string,
  index: number,
): TradeUpInput {
  return {
    listing_id: `${source}-${index}`,
    skin_id: `${skinName}-${index}`,
    skin_name: skinName,
    collection_name: "The Dreams & Nightmares Collection",
    price_cents: priceCents,
    float_value: 0.32,
    condition,
    source,
  };
}

function outcome(
  skinName: string,
  probability: number,
  priceCents: number,
  condition: Condition,
): TradeUpOutcome {
  return {
    skin_id: skinName,
    skin_name: skinName,
    collection_name: "The Dreams & Nightmares Collection",
    probability,
    predicted_float: 0.31,
    predicted_condition: condition,
    estimated_price_cents: priceCents,
    sell_marketplace: "csfloat",
  };
}

const SAMPLE: TradeUp[] = [
  {
    id: -1,
    type: "classified_covert",
    total_cost_cents: 5100,
    expected_value_cents: 5991,
    profit_cents: 891,
    roi_percentage: 17.5,
    created_at: "",
    inputs: [
      listing("Dual Berettas | Melondrama", 529, "Well-Worn", "csfloat", 1),
      listing("Dual Berettas | Melondrama", 531, "Well-Worn", "csfloat", 2),
      listing("Dual Berettas | Melondrama", 522, "Well-Worn", "dmarket", 3),
      listing("Dual Berettas | Melondrama", 518, "Well-Worn", "skinport", 4),
      listing("FAMAS | Rapid Eye Movement", 532, "Well-Worn", "csfloat", 5),
      listing("FAMAS | Rapid Eye Movement", 521, "Well-Worn", "csfloat", 6),
      listing("FAMAS | Rapid Eye Movement", 500, "Well-Worn", "buff", 7),
      listing("FAMAS | Rapid Eye Movement", 512, "Well-Worn", "dmarket", 8),
      listing("MP7 | Abyssal Apparition", 478, "Minimal Wear", "skinport", 9),
      listing("MP7 | Abyssal Apparition", 457, "Minimal Wear", "csfloat", 10),
    ],
    outcomes: [
      outcome("AK-47 | Nightwish", 0.5, 5960, "Field-Tested"),
      outcome("MP9 | Starlight Protector", 0.5, 6022, "Field-Tested"),
    ],
  },
  {
    id: -2,
    type: "restricted_classified",
    total_cost_cents: 1270,
    expected_value_cents: 1640,
    profit_cents: 370,
    roi_percentage: 29.1,
    created_at: "",
    inputs: [
      listing("P2000 | Wicked Sick", 130, "Field-Tested", "dmarket", 11),
      listing("P90 | Baroque Red", 128, "Field-Tested", "csfloat", 12),
      listing("AUG | Death by Puppy", 124, "Field-Tested", "skinport", 13),
    ],
    outcomes: [
      outcome("AK-47 | Wasteland Rebel", 0.5, 2210, "Field-Tested"),
      outcome("Glock-18 | Water Elemental", 0.5, 1060, "Field-Tested"),
    ],
  },
];

const SAMPLE_NAMES = SAMPLE.flatMap((tu) => [
  ...tu.inputs.map((row) => row.skin_name),
  ...tu.outcomes.map((row) => row.skin_name),
]);

export function DeviceScreen({ compact = false }: { compact?: boolean }) {
  const names = useMemo(() => [...new Set(SAMPLE_NAMES)], []);
  useFaces(names);
  const [expanded, setExpanded] = useState<number | null>(null);
  const cards = compact ? SAMPLE.slice(0, 1) : SAMPLE;

  return (
    <div className={`tub-console ${compact ? "tub-console--phone" : ""}`}>
      <aside className="tub-console__nav">
        {["Board", "Calculator", "Account", "Pricing"].map((item, i) => (
          <span key={item} data-active={i === 0}>{item}</span>
        ))}
      </aside>
      <div className="tub-console__main">
        <header className="tub-console__head">
          <strong>Live trade-ups</strong>
          <span className="preview-chip">Example board</span>
        </header>
        <div className="preview-bento">
          {cards.map((tu) => (
            <TradeUpCard
              key={tu.id}
              tu={tu}
              expanded={expanded === tu.id}
              onExpand={(id) => setExpanded(id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
