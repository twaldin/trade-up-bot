/**
 * Complete mapping of CS2 cases to their collections, knife pools, and glove pools.
 *
 * Knife finish "sets" follow a well-known grouping:
 *   Set 1 ("Original"):   Vanilla, Fade, Slaughter, Case Hardened, Stained, Night, Blue Steel,
 *                          Crimson Web, Boreal Forest, Scorched, Safari Mesh, Forest DDPAT, Urban Masked
 *   Set 2 ("Chroma"):     Doppler (incl. Ruby/Sapphire/Black Pearl), Marble Fade, Tiger Tooth,
 *                          Ultraviolet, Damascus Steel, Rust Coat
 *   Set 3 ("Gamma"):      Gamma Doppler (incl. Emerald), Autotronic, Lore, Black Laminate,
 *                          Freehand, Bright Water
 *
 * Glove "generations":
 *   Gen 1: Bloodhound, Driver, Hand Wraps, Moto, Specialist, Sport
 *          (Glove Case, Operation Hydra Case)
 *   Gen 2: Driver, Hand Wraps, Hydra, Moto, Specialist, Sport
 *          (Clutch Case, Revolution Case)
 *   Gen 3: Broken Fang, Driver, Hand Wraps, Moto, Specialist, Sport
 *          (Operation Broken Fang Case, Snakebite Case, Recoil Case)
 */

// ---------------------------------------------------------------------------
// Knife finish sets
// ---------------------------------------------------------------------------

export const KNIFE_FINISH_SET_1_ORIGINAL = [
  'Vanilla', 'Fade', 'Slaughter', 'Case Hardened', 'Stained', 'Night',
  'Blue Steel', 'Crimson Web', 'Boreal Forest', 'Scorched', 'Safari Mesh',
  'Forest DDPAT', 'Urban Masked',
] as const;

export const KNIFE_FINISH_SET_2_CHROMA = [
  'Doppler', 'Marble Fade', 'Tiger Tooth', 'Ultraviolet',
  'Damascus Steel', 'Rust Coat',
] as const;

export const KNIFE_FINISH_SET_3_GAMMA = [
  'Gamma Doppler', 'Autotronic', 'Lore', 'Black Laminate',
  'Freehand', 'Bright Water',
] as const;

// ---------------------------------------------------------------------------
// Glove pools
// ---------------------------------------------------------------------------

export const GLOVE_POOL_GEN1 = {
  label: 'Gen 1',
  types: [
    'Bloodhound Gloves', 'Driver Gloves', 'Hand Wraps',
    'Moto Gloves', 'Specialist Gloves', 'Sport Gloves',
  ],
  skins: {
    'Bloodhound Gloves': ['Charred', 'Bronzed', 'Snakebite', 'Guerrilla'],
    'Driver Gloves': ['Lunar Weave', 'Crimson Weave', 'Convoy', 'Diamondback'],
    'Hand Wraps': ['Leather', 'Badlands', 'Slaughter', 'Spruce DDPAT'],
    'Moto Gloves': ['Spearmint', 'Cool Mint', 'Eclipse', 'Boom!'],
    'Specialist Gloves': ['Crimson Kimono', 'Emerald Web', 'Foundation', 'Forest DDPAT'],
    'Sport Gloves': ['Hedge Maze', 'Superconductor', 'Arid', "Pandora's Box"],
  },
} as const;

export const GLOVE_POOL_GEN2 = {
  label: 'Gen 2',
  types: [
    'Driver Gloves', 'Hand Wraps', 'Hydra Gloves',
    'Moto Gloves', 'Specialist Gloves', 'Sport Gloves',
  ],
  skins: {
    'Driver Gloves': ['Imperial Plaid', 'King Snake', 'Overtake', 'Racing Green'],
    'Hand Wraps': ['Cobalt Skulls', 'Duct Tape', 'Overprint', 'Arboreal'],
    'Hydra Gloves': ['Emerald', 'Case Hardened', 'Mangrove', 'Rattler'],
    'Moto Gloves': ['Polygon', 'POW!', 'Transport', 'Turtle'],
    'Specialist Gloves': ['Fade', 'Buckshot', 'Crimson Web', 'Mogul'],
    'Sport Gloves': ['Vice', 'Amphibious', 'Omega', 'Bronze Morph'],
  },
} as const;

export const GLOVE_POOL_GEN3 = {
  label: 'Gen 3',
  types: [
    'Broken Fang Gloves', 'Driver Gloves', 'Hand Wraps',
    'Moto Gloves', 'Specialist Gloves', 'Sport Gloves',
  ],
  skins: {
    'Broken Fang Gloves': ['Needle Point', 'Jade', 'Unhinged', 'Yellow-banded'],
    'Driver Gloves': ['Snow Leopard', 'Black Tie', 'Queen Jaguar', 'Rezan the Red'],
    'Hand Wraps': ['CAUTION!', 'Desert Shamagh', 'Constrictor', 'Giraffe'],
    'Moto Gloves': ['Blood Pressure', 'Smoke Out', 'Finish Line', '3rd Commando Company'],
    'Specialist Gloves': ['Marble Fade', 'Tiger Strike', 'Field Agent', 'Lt. Commander'],
    'Sport Gloves': ['Scarlet Shamagh', 'Nocts', 'Slingshot', 'Big Game'],
  },
} as const;

// ---------------------------------------------------------------------------
// Case data type
// ---------------------------------------------------------------------------

export interface CaseData {
  caseName: string;
  collectionName: string;
  knifeTypes: string[];
  knifeFinishSet: 'original' | 'chroma' | 'gamma';
  glovePool: typeof GLOVE_POOL_GEN1 | typeof GLOVE_POOL_GEN2 | typeof GLOVE_POOL_GEN3 | null;
}

// ---------------------------------------------------------------------------
// Complete case → collection → knife/glove mapping
// ---------------------------------------------------------------------------

export const CS2_CASES: CaseData[] = [
  // =========================================================================
  // GROUP A: Original 5 knives (Bayonet, Flip, Gut, Karambit, M9 Bayonet)
  // =========================================================================

  // --- Set 1 (Original finishes) ---
  {
    caseName: 'CS:GO Weapon Case',
    collectionName: 'The Arms Deal Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'CS:GO Weapon Case 2',
    collectionName: 'The Arms Deal 2 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'CS:GO Weapon Case 3',
    collectionName: 'The Arms Deal 3 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'eSports 2013 Case',
    collectionName: 'The eSports 2013 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'eSports 2013 Winter Case',
    collectionName: 'The eSports 2013 Winter Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'eSports 2014 Summer Case',
    collectionName: 'The eSports 2014 Summer Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Operation Bravo Case',
    collectionName: 'The Bravo Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Winter Offensive Weapon Case',
    collectionName: 'The Winter Offensive Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Operation Phoenix Weapon Case',
    collectionName: 'The Phoenix Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Operation Vanguard Weapon Case',
    collectionName: 'The Vanguard Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Revolver Case',
    collectionName: 'The Revolver Case Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // --- Set 2 (Chroma finishes) ---
  {
    caseName: 'Chroma Case',
    collectionName: 'The Chroma Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },
  {
    caseName: 'Chroma 2 Case',
    collectionName: 'The Chroma 2 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },
  {
    caseName: 'Chroma 3 Case',
    collectionName: 'The Chroma 3 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },

  // --- Set 3 (Gamma finishes) ---
  {
    caseName: 'Gamma Case',
    collectionName: 'The Gamma Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'gamma',
    glovePool: null,
  },
  {
    caseName: 'Gamma 2 Case',
    collectionName: 'The Gamma 2 Collection',
    knifeTypes: ['Bayonet', 'Flip Knife', 'Gut Knife', 'Karambit', 'M9 Bayonet'],
    knifeFinishSet: 'gamma',
    glovePool: null,
  },

  // =========================================================================
  // GROUP B: Secondary 5 knives (Bowie, Butterfly, Falchion, Huntsman, Shadow Daggers)
  // =========================================================================

  // --- Set 1 (Original finishes) — single-knife cases ---
  {
    caseName: 'Huntsman Weapon Case',
    collectionName: 'The Huntsman Collection',
    knifeTypes: ['Huntsman Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Operation Breakout Weapon Case',
    collectionName: 'The Breakout Collection',
    knifeTypes: ['Butterfly Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Falchion Case',
    collectionName: 'The Falchion Collection',
    knifeTypes: ['Falchion Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Shadow Case',
    collectionName: 'The Shadow Collection',
    knifeTypes: ['Shadow Daggers'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Operation Wildfire Case',
    collectionName: 'The Wildfire Collection',
    knifeTypes: ['Bowie Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // --- Set 2 (Chroma/Spectrum finishes) ---
  {
    caseName: 'Spectrum Case',
    collectionName: 'The Spectrum Collection',
    knifeTypes: ['Bowie Knife', 'Butterfly Knife', 'Falchion Knife', 'Huntsman Knife', 'Shadow Daggers'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },
  {
    caseName: 'Spectrum 2 Case',
    collectionName: 'The Spectrum 2 Collection',
    knifeTypes: ['Bowie Knife', 'Butterfly Knife', 'Falchion Knife', 'Huntsman Knife', 'Shadow Daggers'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },

  // --- Set 3 (Gamma/Riptide finishes) ---
  {
    caseName: 'Operation Riptide Case',
    collectionName: 'The Operation Riptide Collection',
    knifeTypes: ['Bowie Knife', 'Butterfly Knife', 'Falchion Knife', 'Huntsman Knife', 'Shadow Daggers'],
    knifeFinishSet: 'gamma',
    glovePool: null,
  },
  {
    caseName: 'Dreams & Nightmares Case',
    collectionName: 'The Dreams & Nightmares Collection',
    knifeTypes: ['Bowie Knife', 'Butterfly Knife', 'Falchion Knife', 'Huntsman Knife', 'Shadow Daggers'],
    knifeFinishSet: 'gamma',
    glovePool: null,
  },

  // =========================================================================
  // GROUP C: Horizon knives (Navaja, Stiletto, Talon, Ursus)
  // =========================================================================

  // --- Set 1 (Original finishes) ---
  {
    caseName: 'Horizon Case',
    collectionName: 'The Horizon Collection',
    knifeTypes: ['Navaja Knife', 'Stiletto Knife', 'Talon Knife', 'Ursus Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Danger Zone Case',
    collectionName: 'The Danger Zone Collection',
    knifeTypes: ['Navaja Knife', 'Stiletto Knife', 'Talon Knife', 'Ursus Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // --- Set 2 (Chroma/Prisma finishes) ---
  {
    caseName: 'Prisma Case',
    collectionName: 'The Prisma Collection',
    knifeTypes: ['Navaja Knife', 'Stiletto Knife', 'Talon Knife', 'Ursus Knife'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },
  {
    caseName: 'Prisma 2 Case',
    collectionName: 'The Prisma 2 Collection',
    knifeTypes: ['Navaja Knife', 'Stiletto Knife', 'Talon Knife', 'Ursus Knife'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },

  // =========================================================================
  // GROUP D: Classic Knife
  // =========================================================================

  {
    caseName: 'CS20 Case',
    collectionName: 'The CS20 Collection',
    knifeTypes: ['Classic Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // =========================================================================
  // GROUP E: Shattered Web knives (Nomad, Paracord, Skeleton, Survival)
  // =========================================================================

  // --- Set 1 (Original finishes) ---
  {
    caseName: 'Shattered Web Case',
    collectionName: 'The Shattered Web Collection',
    knifeTypes: ['Nomad Knife', 'Paracord Knife', 'Skeleton Knife', 'Survival Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Fracture Case',
    collectionName: 'The Fracture Collection',
    knifeTypes: ['Nomad Knife', 'Paracord Knife', 'Skeleton Knife', 'Survival Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // --- Set 2 (Chroma finishes) ---
  {
    caseName: 'Fever Case',
    collectionName: 'The Fever Collection',
    knifeTypes: ['Nomad Knife', 'Paracord Knife', 'Skeleton Knife', 'Survival Knife'],
    knifeFinishSet: 'chroma',
    glovePool: null,
  },

  // =========================================================================
  // GROUP F: Kukri Knife
  // =========================================================================

  {
    caseName: 'Kilowatt Case',
    collectionName: 'The Kilowatt Collection',
    knifeTypes: ['Kukri Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },
  {
    caseName: 'Gallery Case',
    collectionName: 'The Gallery Collection',
    knifeTypes: ['Kukri Knife'],
    knifeFinishSet: 'original',
    glovePool: null,
  },

  // =========================================================================
  // GROUP G: Glove cases (knives replaced by gloves as rare special item)
  // =========================================================================

  // --- Gen 1 gloves (Bloodhound, Driver, Hand Wraps, Moto, Specialist, Sport) ---
  {
    caseName: 'Glove Case',
    collectionName: 'The Glove Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN1,
  },
  {
    caseName: 'Operation Hydra Case',
    collectionName: 'The Operation Hydra Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN1,
  },

  // --- Gen 2 gloves (Driver, Hand Wraps, Hydra, Moto, Specialist, Sport) ---
  {
    caseName: 'Clutch Case',
    collectionName: 'The Clutch Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN2,
  },
  {
    caseName: 'Revolution Case',
    collectionName: 'The Revolution Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN2,
  },

  // --- Gen 3 gloves (Broken Fang, Driver, Hand Wraps, Moto, Specialist, Sport) ---
  {
    caseName: 'Operation Broken Fang Case',
    collectionName: 'The Operation Broken Fang Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN3,
  },
  {
    caseName: 'Snakebite Case',
    collectionName: 'The Snakebite Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN3,
  },
  {
    caseName: 'Recoil Case',
    collectionName: 'The Recoil Collection',
    knifeTypes: [],
    knifeFinishSet: 'original', // n/a
    glovePool: GLOVE_POOL_GEN3,
  },
];

// ---------------------------------------------------------------------------
// Non-case collections (operations, souvenirs, map drops)
// These have Covert skins but are NOT opened from weapon cases.
// They have NO knife/glove pool — only weapon skins.
// ---------------------------------------------------------------------------

export const NON_CASE_COLLECTIONS = [
  'Limited Edition Item',
  'The Ancient Collection',
  'The Anubis Collection',
  'The Canals Collection',
  'The Cobblestone Collection',
  'The Control Collection',
  'The Genesis Collection',
  'The Gods and Monsters Collection',
  'The Graphic Design Collection',
  'The Havoc Collection',
  'The Norse Collection',
  'The Overpass 2024 Collection',
  'The Rising Sun Collection',
  'The Sport & Field Collection',
  'The St. Marc Collection',
  'The Train 2025 Collection',
  'The 2021 Dust 2 Collection',
  'The 2021 Mirage Collection',
  'The 2021 Train Collection',
  'The 2021 Vertigo Collection',
] as const;

// ---------------------------------------------------------------------------
// Utility lookups
// ---------------------------------------------------------------------------

/** Map from collection name → case data (for case-based collections) */
export const COLLECTION_TO_CASE = new Map<string, CaseData>(
  CS2_CASES.map(c => [c.collectionName, c])
);

/** Map from case name → case data */
export const CASE_BY_NAME = new Map<string, CaseData>(
  CS2_CASES.map(c => [c.caseName, c])
);

/** Get knife finishes for a finish set */
export function getKnifeFinishes(set: 'original' | 'chroma' | 'gamma') {
  switch (set) {
    case 'original': return [...KNIFE_FINISH_SET_1_ORIGINAL];
    case 'chroma':   return [...KNIFE_FINISH_SET_2_CHROMA];
    case 'gamma':    return [...KNIFE_FINISH_SET_3_GAMMA];
  }
}

/** Check if a collection comes from a case (vs. operation/souvenir) */
export function isCaseCollection(collectionName: string): boolean {
  return COLLECTION_TO_CASE.has(collectionName);
}

/** Get all cases that drop gloves */
export function getGloveCases(): CaseData[] {
  return CS2_CASES.filter(c => c.glovePool !== null);
}

/** Get all cases that drop knives */
export function getKnifeCases(): CaseData[] {
  return CS2_CASES.filter(c => c.knifeTypes.length > 0);
}
