import { isUsableImageUrl } from "../../../shared/skin-image.js";

export function SkinRender({
  name,
  url,
  className = "",
}: {
  name: string;
  url?: string | null;
  className?: string;
}) {
  if (isUsableImageUrl(url)) {
    return <img src={url} alt={name} title={name} className={className} />;
  }
  return <span className={`pv-empty ${className}`} title={name || "Empty slot"} aria-label={name ? `No image for ${name}` : "Empty slot"} />;
}
