/**
 * Knife/Glove constant data: finish sets, glove generations, and CASE_KNIFE_MAP.
 * Pure data — no dependencies, no DB access.
 */

export interface CaseMapping {
  knifeTypes: string[];
  knifeFinishes: string[]; // specific finish names (e.g. "Fade", "Doppler") — empty = all
  gloveGen: 1 | 2 | 3 | 4 | null; // which glove generation, null = no gloves
}

// Knife finish sets — each case only drops finishes from ONE set
export const KNIFE_FINISHES_ORIGINAL = [
  "Vanilla", "Fade", "Slaughter", "Case Hardened", "Stained", "Night",
  "Blue Steel", "Crimson Web", "Boreal Forest", "Scorched", "Safari Mesh",
  "Forest DDPAT", "Urban Masked",
];
export const KNIFE_FINISHES_CHROMA = [
  "Doppler", "Marble Fade", "Tiger Tooth", "Ultraviolet", "Damascus Steel", "Rust Coat",
];
export const KNIFE_FINISHES_GAMMA = [
  "Gamma Doppler", "Autotronic", "Lore", "Black Laminate", "Freehand", "Bright Water",
];

// Glove skins per generation — maps glove type → finish names for that gen
export const GLOVE_GEN_SKINS: Record<number, Record<string, string[]>> = {
  1: {
    "Bloodhound Gloves": ["Charred", "Bronzed", "Snakebite", "Guerrilla"],
    "Driver Gloves": ["Lunar Weave", "Crimson Weave", "Convoy", "Diamondback"],
    "Hand Wraps": ["Leather", "Badlands", "Slaughter", "Spruce DDPAT"],
    "Moto Gloves": ["Spearmint", "Cool Mint", "Eclipse", "Boom!"],
    "Specialist Gloves": ["Crimson Kimono", "Emerald Web", "Foundation", "Forest DDPAT"],
    "Sport Gloves": ["Hedge Maze", "Superconductor", "Arid", "Pandora's Box"],
  },
  2: {
    "Driver Gloves": ["Imperial Plaid", "King Snake", "Overtake", "Racing Green"],
    "Hand Wraps": ["Cobalt Skulls", "Duct Tape", "Overprint", "Arboreal"],
    "Hydra Gloves": ["Emerald", "Case Hardened", "Mangrove", "Rattler"],
    "Moto Gloves": ["Polygon", "POW!", "Transport", "Turtle"],
    "Specialist Gloves": ["Fade", "Buckshot", "Crimson Web", "Mogul"],
    "Sport Gloves": ["Vice", "Amphibious", "Omega", "Bronze Morph"],
  },
  3: {
    "Broken Fang Gloves": ["Needle Point", "Jade", "Unhinged", "Yellow-banded"],
    "Driver Gloves": ["Snow Leopard", "Black Tie", "Queen Jaguar", "Rezan the Red"],
    "Hand Wraps": ["CAUTION!", "Desert Shamagh", "Constrictor", "Giraffe"],
    "Moto Gloves": ["Blood Pressure", "Smoke Out", "Finish Line", "3rd Commando Company"],
    "Specialist Gloves": ["Marble Fade", "Tiger Strike", "Field Agent", "Lt. Commander"],
    "Sport Gloves": ["Scarlet Shamagh", "Nocts", "Slingshot", "Big Game"],
  },
  4: {
    "Driver Gloves": ["Wave Chaser", "Seigaiha", "Plum Quill", "Hand Sweaters", "Garden", "Dragon Fists", "Brocade Flowers", "Brocade Crane"],
    "Specialist Gloves": ["Big Swell", "Sunburst", "Pillow Punchers", "Chocolate Chesterfield", "Blackbook", "Cloud Chaser", "Lime Polycam"],
    "Sport Gloves": ["Ultra Violent", "Creme Pinstripe", "Red Racer", "Blaze", "Frosty", "Violet Beadwork", "Occult"],
  },
};

// Knife type groups
export const OG5 = ["Bayonet", "Flip Knife", "Gut Knife", "Karambit", "M9 Bayonet"];
export const SEC5 = ["Bowie Knife", "Butterfly Knife", "Falchion Knife", "Huntsman Knife", "Shadow Daggers"];
export const HOR4 = ["Navaja Knife", "Stiletto Knife", "Talon Knife", "Ursus Knife"];
export const SW4 = ["Nomad Knife", "Paracord Knife", "Skeleton Knife", "Survival Knife"];

/**
 * Maps collection name → knife/glove pool from that case.
 * Source: shared/caseData.ts (comprehensive research, Oct 2025 knife trade-up update)
 *
 * Key corrections from detailed research:
 *   - Glove cases (Glove, Hydra, Clutch, Revolution, Broken Fang, Snakebite, Recoil) have NO knives
 *   - Non-case collections (Genesis, Ancient, Norse, etc.) have no knife/glove pool
 *   - Each case has a specific finish set (original/chroma/gamma)
 */
export const CASE_KNIFE_MAP: Record<string, CaseMapping> = {
  // Group A: Original 5 knives
  // Original finishes
  "The Arms Deal Collection":          { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Arms Deal 2 Collection":        { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Arms Deal 3 Collection":        { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The eSports 2013 Collection":       { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The eSports 2013 Winter Collection": { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The eSports 2014 Summer Collection": { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Bravo Collection":              { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Winter Offensive Collection":   { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Phoenix Collection":            { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Vanguard Collection":           { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Revolver Case Collection":      { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  // Chroma finishes
  "The Chroma Collection":   { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  "The Chroma 2 Collection": { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  "The Chroma 3 Collection": { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  // Gamma finishes
  "The Gamma Collection":   { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_GAMMA, gloveGen: null },
  "The Gamma 2 Collection": { knifeTypes: OG5, knifeFinishes: KNIFE_FINISHES_GAMMA, gloveGen: null },

  // Group B: Secondary 5 knives
  // Original finishes (single-knife cases)
  "The Huntsman Collection": { knifeTypes: ["Huntsman Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Breakout Collection": { knifeTypes: ["Butterfly Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Falchion Collection": { knifeTypes: ["Falchion Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Shadow Collection":   { knifeTypes: ["Shadow Daggers"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Wildfire Collection":  { knifeTypes: ["Bowie Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  // Chroma/Spectrum finishes
  "The Spectrum Collection":   { knifeTypes: SEC5, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  "The Spectrum 2 Collection": { knifeTypes: SEC5, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  // Gamma finishes
  "The Operation Riptide Collection":      { knifeTypes: SEC5, knifeFinishes: KNIFE_FINISHES_GAMMA, gloveGen: null },
  "The Dreams & Nightmares Collection": { knifeTypes: SEC5, knifeFinishes: KNIFE_FINISHES_GAMMA, gloveGen: null },

  // Group C: Horizon knives
  "The Horizon Collection":    { knifeTypes: HOR4, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Danger Zone Collection": { knifeTypes: HOR4, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Prisma Collection":     { knifeTypes: HOR4, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },
  "The Prisma 2 Collection":   { knifeTypes: HOR4, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },

  // Group D: Classic Knife
  "The CS20 Collection": { knifeTypes: ["Classic Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },

  // Group E: Shattered Web knives
  "The Shattered Web Collection": { knifeTypes: SW4, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Fracture Collection":     { knifeTypes: SW4, knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Fever Collection":        { knifeTypes: SW4, knifeFinishes: KNIFE_FINISHES_CHROMA, gloveGen: null },

  // Group F: Kukri Knife
  "The Kilowatt Collection": { knifeTypes: ["Kukri Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },
  "The Gallery Collection":  { knifeTypes: ["Kukri Knife"], knifeFinishes: KNIFE_FINISHES_ORIGINAL, gloveGen: null },

  // Glove-only cases
  "The Glove Collection":              { knifeTypes: [], knifeFinishes: [], gloveGen: 1 },
  "The Operation Hydra Collection":    { knifeTypes: [], knifeFinishes: [], gloveGen: 1 },
  "The Clutch Collection":             { knifeTypes: [], knifeFinishes: [], gloveGen: 2 },
  "The Revolution Collection":         { knifeTypes: [], knifeFinishes: [], gloveGen: 2 },
  "The Operation Broken Fang Collection": { knifeTypes: [], knifeFinishes: [], gloveGen: 3 },
  "The Snakebite Collection":          { knifeTypes: [], knifeFinishes: [], gloveGen: 3 },
  "The Recoil Collection":             { knifeTypes: [], knifeFinishes: [], gloveGen: 3 },

  // Gen 4 gloves (Dead Hand Terminal -- Driver, Specialist, Sport)
  "The Dead Hand Collection":          { knifeTypes: [], knifeFinishes: [], gloveGen: 4 },
};

// Doppler/Gamma Doppler phase weights (probability of each phase when traded up)
export const DOPPLER_PHASES: Record<string, { phase: string; weight: number }[]> = {
  "Doppler": [
    { phase: "Phase 1",     weight: 0.2465 },
    { phase: "Phase 2",     weight: 0.2465 },
    { phase: "Phase 3",     weight: 0.2465 },
    { phase: "Phase 4",     weight: 0.2465 },
    { phase: "Ruby",        weight: 0.0040 },
    { phase: "Sapphire",    weight: 0.0040 },
    { phase: "Black Pearl", weight: 0.0060 },
  ],
  "Gamma Doppler": [
    { phase: "Phase 1", weight: 0.248 },
    { phase: "Phase 2", weight: 0.248 },
    { phase: "Phase 3", weight: 0.248 },
    { phase: "Phase 4", weight: 0.246 },
    { phase: "Emerald",  weight: 0.010 },
  ],
};

/** All knife weapon types — used to filter knife listings from gun listings. */
export const KNIFE_WEAPONS = [
  "Bayonet", "Karambit", "Butterfly Knife", "Flip Knife", "Gut Knife",
  "Huntsman Knife", "M9 Bayonet", "Falchion Knife", "Shadow Daggers",
  "Bowie Knife", "Navaja Knife", "Stiletto Knife", "Ursus Knife",
  "Talon Knife", "Classic Knife", "Paracord Knife", "Survival Knife",
  "Nomad Knife", "Skeleton Knife", "Kukri Knife",
] as const;

export interface FinishData {
  name: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  conditions: number;
  skinMinFloat: number;
  skinMaxFloat: number;
}
