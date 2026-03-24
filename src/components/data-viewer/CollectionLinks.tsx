import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { collectionToSlug } from "../../../shared/slugs.js";

interface CollectionLinksProps {
  collectionName: string | null;
  onNavigate?: (name: string) => void;
  compact?: boolean;
}

export function CollectionLinks({ collectionName, onNavigate, compact }: CollectionLinksProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!collectionName) return <span className="text-muted-foreground">&mdash;</span>;

  const cols = collectionName.split(",").map(c => c.trim()).filter(Boolean);

  const renderLink = (name: string, key: number) => (
    <span key={key}>
      {key > 0 && ", "}
      <Link
        to={`/collections/${collectionToSlug(name)}`}
        className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-blue-400 transition-colors"
        onClick={(e) => { e.stopPropagation(); if (onNavigate) onNavigate(name); }}
      >{name}</Link>
    </span>
  );

  if (!compact) return <>{cols.map((c, i) => renderLink(c, i))}</>;

  if (cols.length <= 1) return <>{cols.map((c, i) => renderLink(c, i))}</>;

  return (
    <div className="relative inline" ref={dropdownRef}>
      <span
        className="text-blue-400 cursor-pointer underline decoration-dotted underline-offset-2 hover:text-blue-400"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >({cols.length} collections)</span>
      {open && (
        <div className="absolute top-full left-0 z-[100] bg-secondary border border-border rounded-md py-1 min-w-[220px] max-h-[300px] overflow-y-auto shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          {cols.map((c, i) => (
            <Link
              key={i}
              to={`/collections/${collectionToSlug(c)}`}
              className="block px-3 py-1.5 text-foreground/80 text-[0.8rem] whitespace-nowrap hover:bg-accent hover:text-blue-400 no-underline"
              onClick={(e) => { e.stopPropagation(); if (onNavigate) onNavigate(c); setOpen(false); }}
            >{c}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
