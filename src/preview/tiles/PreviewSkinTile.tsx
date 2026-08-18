import { rarityFadeHex, type Cs2Rarity } from "../../../shared/preview-board.js";
import { SkinRender } from "../images/SkinRender.js";

export function PreviewSkinTile({
  name,
  url,
  badge,
  rarity,
  size,
  price,
  onActivate,
}: {
  name: string;
  url?: string | null;
  badge: string;
  rarity: Cs2Rarity;
  size: "in" | "out";
  price?: string;
  onActivate?: () => void;
}) {
  const hue = rarityFadeHex(rarity);
  const sizeClass = size === "out" ? "pv-tile-out" : "pv-tile-in";
  return (
    <button
      type="button"
      className={`pv-tile ${sizeClass}`}
      title={name}
      onClick={event => {
        event.stopPropagation();
        onActivate?.();
      }}
    >
      {price ? <span className="pv-tile-price">{price}</span> : null}
      <span className="pv-tile-badge">{badge}</span>
      <SkinRender name={name} url={url} className="pv-tile-art" />
      <span className="pv-tile-name" style={{ color: hue }}>{name}</span>
    </button>
  );
}
