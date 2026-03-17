/** Shared rarity color definitions used across the app */

export interface RarityStyle {
  value: string;
  label: string;
  /** Tailwind classes for active pill: border + bg + text */
  active: string;
  /** Tailwind classes for inactive pill */
  inactive: string;
}

const PILL_INACTIVE = "border-transparent text-muted-foreground hover:text-foreground";

/** Trade-up type tabs — colored by OUTPUT rarity */
export const TRADE_UP_TYPES: RarityStyle[] = [
  { value: "all", label: "All", active: "border-foreground/40 bg-foreground/10 text-foreground", inactive: PILL_INACTIVE },
  { value: "covert_knife", label: "Knife/Gloves", active: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500", inactive: PILL_INACTIVE },
  { value: "classified_covert", label: "Covert", active: "border-red-500/40 bg-red-500/10 text-red-500", inactive: PILL_INACTIVE },
  { value: "restricted_classified", label: "Classified", active: "border-pink-500/40 bg-pink-500/10 text-pink-500", inactive: PILL_INACTIVE },
  { value: "milspec_restricted", label: "Restricted", active: "border-purple-500/40 bg-purple-500/10 text-purple-500", inactive: PILL_INACTIVE },
  { value: "industrial_milspec", label: "Mil-Spec", active: "border-blue-500/40 bg-blue-500/10 text-blue-500", inactive: PILL_INACTIVE },
];

/** Skin rarity tabs — for DataViewer and collection skins */
export const SKIN_RARITIES: RarityStyle[] = [
  { value: "all", label: "All", active: "border-foreground/40 bg-foreground/10 text-foreground", inactive: PILL_INACTIVE },
  { value: "Covert", label: "Covert", active: "border-red-500/40 bg-red-500/10 text-red-500", inactive: PILL_INACTIVE },
  { value: "Classified", label: "Classified", active: "border-pink-500/40 bg-pink-500/10 text-pink-500", inactive: PILL_INACTIVE },
  { value: "Restricted", label: "Restricted", active: "border-purple-500/40 bg-purple-500/10 text-purple-500", inactive: PILL_INACTIVE },
  { value: "Mil-Spec", label: "Mil-Spec", active: "border-blue-500/40 bg-blue-500/10 text-blue-500", inactive: PILL_INACTIVE },
  { value: "Industrial Grade", label: "Industrial", active: "border-sky-400/40 bg-sky-400/10 text-sky-400", inactive: PILL_INACTIVE },
  { value: "Consumer Grade", label: "Consumer", active: "border-gray-400/40 bg-gray-400/10 text-gray-400", inactive: PILL_INACTIVE },
  { value: "knife_glove", label: "Knife/Glove", active: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500", inactive: PILL_INACTIVE },
];

/** Pill class helper */
export function pillClass(isActive: boolean, style: RarityStyle): string {
  return `px-4 py-1.5 text-sm font-medium rounded-full border transition-colors cursor-pointer ${isActive ? style.active : style.inactive}`;
}

/** Claims pill */
export const CLAIMS_PILL = {
  active: "border-purple-500/40 bg-purple-500/10 text-purple-500",
  inactive: PILL_INACTIVE,
};
