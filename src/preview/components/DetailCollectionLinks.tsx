import { Link } from "react-router-dom";
import { collectionTradeUpLinks } from "../../../shared/collection-links.js";
import { trackCtaClick } from "../../lib/conversions.js";

export function DetailCollectionLinks({ names }: { names: readonly string[] }) {
  const links = collectionTradeUpLinks(names);
  if (links.length === 0) return null;
  return (
    <nav className="preview-detail-collections" aria-label="Collections in this trade-up">
      {links.map((link) => (
        <Link
          key={link.url}
          className="preview-btn"
          to={link.url}
          onClick={() => trackCtaClick("detail_collection")}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
