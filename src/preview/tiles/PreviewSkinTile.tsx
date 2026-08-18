import { rarityFadeHex, type Cs2Rarity } from "../../../shared/preview-board.js";
import { SkinRender } from "../images/SkinRender.js";

export function PreviewSkinTile({
  name,
  url,
  badge,
  rarity,
  size,
}: {
  name: string;
  url?: string | null;
  badge: string;
  rarity: Cs2Rarity;
  size: "in" | "out";
}) {
  const fade = rarityFadeHex(rarity);
  const sizeClass = size === "out" ? "pv-tile-out" : "pv-tile-in";
  return (
    <div className={`pv-tile ${sizeClass}`} title={name}>
      <span className="pv-tile-badge">{badge}</span>
      <SkinRender name={name} url={url} className="pv-tile-art" />
      <span className="pv-tile-fade" style={{ background: `linear-gradient(to top, ${fade} 0%, transparent 72%)` }} />
      <span className="pv-tile-name">{name}</span>
    </div>
  );
}
