import { formatDollars } from "../../utils/format.js";
import type { SkinSummary } from "./types.js";
import { CONDITION_ORDER } from "./types.js";
import { CollectionLinks } from "./CollectionLinks.js";

interface SkinListProps {
  skins: SkinSummary[];
  selectedSkin: string | null;
  onSelectSkin: (name: string) => void;
  loading: boolean;
  onNavigateCollection?: (name: string) => void;
}

/** Skeleton pulse row for loading state */
function SkeletonRow({ delay }: { delay: number }) {
  return (
    <div className="px-3 py-2.5 border-b border-border/70" style={{ animationDelay: `${delay}ms` }}>
      <div className="animate-pulse space-y-1.5">
        <div className="h-4 w-3/4 bg-muted rounded" />
        <div className="flex gap-2">
          <div className="h-3 w-24 bg-muted rounded" />
          <div className="h-3 w-16 bg-muted rounded" />
          <div className="h-3 w-12 bg-muted rounded" />
        </div>
      </div>
    </div>
  );
}

export function SkinList({ skins, selectedSkin, onSelectSkin, loading, onNavigateCollection }: SkinListProps) {
  if (loading) {
    return (
      <>
        {Array.from({ length: 12 }, (_, i) => (
          <SkeletonRow key={i} delay={i * 50} />
        ))}
      </>
    );
  }

  if (skins.length === 0) {
    return (
      <div className="py-10 px-4 text-center">
        <div className="text-muted-foreground text-[0.9rem] mb-2">No skins found</div>
        <div className="text-muted-foreground/60 text-[0.8rem]">
          Try a different search term or adjust the rarity filter.
        </div>
      </div>
    );
  }

  return (
    <>
      {skins.map(skin => (
        <div
          key={skin.id}
          className={`px-3 py-2.5 border-b border-border/70 cursor-pointer transition-colors hover:bg-muted ${selectedSkin === skin.name ? "!bg-secondary border-l-[3px] border-l-blue-400" : ""}`}
          onClick={() => onSelectSkin(skin.name)}
        >
          <div className="text-[0.9rem] font-medium text-foreground mb-0.5">{skin.name}</div>
          <div className="flex gap-2.5 text-xs text-muted-foreground">
            <CollectionLinks collectionName={skin.collection_name} onNavigate={onNavigateCollection} compact />
            <span className="text-blue-400">
              {skin.listing_count || 0} listings
            </span>
            <span className="text-green-500">
              {skin.sale_count || 0} sales
            </span>
          </div>
          {skin.prices && Object.keys(skin.prices).length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {CONDITION_ORDER.filter(c => skin.prices[c]).map(c => {
                const best = skin.prices[c];
                const price = best.csfloat_sales || best.listing || best.csfloat_ref || best.skinport;
                if (!price) return null;
                return (
                  <span key={c} className="text-[0.65rem] bg-secondary px-1.5 py-px rounded text-muted-foreground">
                    {c.split(" ").map(w => w[0]).join("")}: {formatDollars(price)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
