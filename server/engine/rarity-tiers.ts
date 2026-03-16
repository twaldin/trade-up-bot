/**
 * Configuration-driven rarity tier system.
 * Each tier defines a trade-up type (N inputs of rarity X → 1 output of rarity Y).
 * Staircase chains compose multiple tiers into multi-step trade-ups.
 */

export interface RarityTierConfig {
  id: string;                    // unique identifier, e.g. "restricted_classified"
  inputRarity: string;           // e.g. "Restricted"
  outputRarity: string;          // e.g. "Classified"
  inputCount: number;            // inputs per trade-up (10 for guns, 5 for knife)
  tradeUpType: string;           // DB type field, e.g. "restricted_classified"
  comboKeyPrefix: string;        // theory tracking prefix, e.g. "restricted:"
  excludeKnifeOutputs: boolean;  // true only for classified_covert (filter ★ outputs)
  listingBudgetFraction: number; // fraction of CSFloat listing budget per cycle
  saleBudgetFraction: number;    // fraction of CSFloat sale budget per cycle
  isKnifeTier: boolean;          // true for covert→knife (5 inputs, special evaluation)
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const RARITY_TIERS: RarityTierConfig[] = [
  {
    id: "milspec_restricted",
    inputRarity: "Mil-Spec",
    outputRarity: "Restricted",
    inputCount: 10,
    tradeUpType: "milspec_restricted",
    comboKeyPrefix: "milspec:",
    excludeKnifeOutputs: false,
    listingBudgetFraction: 0.01,
    saleBudgetFraction: 0.03,
    isKnifeTier: false,
  },
  {
    id: "restricted_classified",
    inputRarity: "Restricted",
    outputRarity: "Classified",
    inputCount: 10,
    tradeUpType: "restricted_classified",
    comboKeyPrefix: "restricted:",
    excludeKnifeOutputs: false,
    listingBudgetFraction: 0.02,
    saleBudgetFraction: 0.05,
    isKnifeTier: false,
  },
  {
    id: "classified_covert",
    inputRarity: "Classified",
    outputRarity: "Covert",
    inputCount: 10,
    tradeUpType: "classified_covert",
    comboKeyPrefix: "classified:",
    excludeKnifeOutputs: true,
    listingBudgetFraction: 0.15,
    saleBudgetFraction: 0.15,
    isKnifeTier: false,
  },
  {
    id: "covert_knife",
    inputRarity: "Covert",
    outputRarity: "Extraordinary",
    inputCount: 5,
    tradeUpType: "covert_knife",
    comboKeyPrefix: "knife:",
    excludeKnifeOutputs: false,
    listingBudgetFraction: 0.20,
    saleBudgetFraction: 0.15,
    isKnifeTier: true,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const tierIndex = new Map<string, RarityTierConfig>(
  RARITY_TIERS.map((t) => [t.id, t]),
);

/** Look up a tier by its unique id. */
export function getTierById(id: string): RarityTierConfig | undefined {
  return tierIndex.get(id);
}

/** Returns all non-knife tiers (for generic gun-rarity discovery loops). */
export function getGunTiers(): RarityTierConfig[] {
  return RARITY_TIERS.filter((t) => !t.isKnifeTier);
}

/** Returns only the newly-added tiers (restricted_classified, milspec_restricted) for incremental rollout. */
export function getNewTiers(): RarityTierConfig[] {
  return RARITY_TIERS.filter(
    (t) => t.id === "restricted_classified" || t.id === "milspec_restricted",
  );
}
