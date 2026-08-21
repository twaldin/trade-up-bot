/**
 * Semantic search field. Typing turns tokens into chips (Max Price, Max Float,
 * Tier, Item…) and offers name completions with the skin render. The parser and
 * chip vocabulary are in `lib/query-parse.ts`; this file is the surface.
 */
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { rarityTint } from "../lib/board.js";
import {
  createNameStore,
  readNameCache,
  rememberNames,
  storeToList,
  writeNameCache,
} from "../lib/name-cache.js";
import { matchNames, parseQuery, typingTail, type Chip, type NameHit, type ParsedQuery } from "../lib/query-parse.js";
import { createFaceCache, faceCacheKey, faceFor, loadFaces, namesFromCacheKey } from "../lib/skin-images.js";

const FACE_CACHE = createFaceCache();
const NAME_STORE = createNameStore();
let hydrated = false;

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  rememberNames(NAME_STORE, readNameCache(storage()));
}

/** Other surfaces call this as they load rows, so the cache grows by itself. */
export function cacheNames(hits: NameHit[]): void {
  hydrateOnce();
  rememberNames(NAME_STORE, hits);
  writeNameCache(storage(), storeToList(NAME_STORE));
}

export function PreviewSearch({
  value,
  onChange,
  onParsed,
  placeholder = "Search trade-ups…",
  examples,
}: {
  value: string;
  onChange: (next: string) => void;
  onParsed?: (parsed: ParsedQuery) => void;
  placeholder?: string;
  examples?: string[];
}) {
  hydrateOnce();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<NameHit[]>(() => storeToList(NAME_STORE));
  const rootRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseQuery(value, names), [value, names]);
  // Completion follows the cursor, not the parser: a word already turned into a
  // chip should still show its render while it is being typed.
  const tail = typingTail(value);
  const suggestions = useMemo(
    () => (tail.length >= 2 ? matchNames(tail, names, 6) : []),
    [tail, names],
  );

  useEffect(() => { onParsed?.(parsed); }, [parsed, onParsed]);

  // Ask the server only for what the local cache could not place.
  useEffect(() => {
    if (tail.length < 2) return;
    let live = true;
    const handle = window.setTimeout(() => {
      fetch(`/api/skin-suggestions?q=${encodeURIComponent(tail)}`, { credentials: "include" })
        .then((res) => res.json())
        .then((data: { results?: { name: string; rarity?: string }[] }) => {
          if (!live || !data.results?.length) return;
          cacheNames(data.results);
          setNames(storeToList(NAME_STORE));
        })
        .catch(() => {});
    }, 180);
    return () => { live = false; window.clearTimeout(handle); };
  }, [tail]);

  useEffect(() => {
    const wanted = suggestions.map((hit) => hit.name);
    if (wanted.length === 0) return;
    let live = true;
    void loadFaces(namesFromCacheKey(faceCacheKey(wanted)), FACE_CACHE)
      .then(() => { if (live) setNames((prev) => [...prev]); });
    return () => { live = false; };
  }, [suggestions]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const accept = (hit: NameHit) => {
    const at = value.toLowerCase().lastIndexOf(tail.toLowerCase());
    const kept = at >= 0 ? value.slice(0, at) : value;
    onChange(`${kept}${hit.name} `.replace(/\s+/g, " ").trimStart());
    setOpen(false);
  };

  const dropChip = (chip: Chip) => {
    onChange(value.replace(chip.source, "").replace(/\s+/g, " ").trim());
  };

  return (
    <div className="preview-search" ref={rootRef}>
      <div className="preview-search__bar">
        <Search size={13} aria-hidden />
        <input
          className="preview-search__input"
          value={value}
          placeholder={placeholder}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label="Search"
        />
        {value && (
          <button type="button" className="preview-search__clear" onClick={() => onChange("")} aria-label="Clear search">
            <X size={12} aria-hidden />
          </button>
        )}
      </div>

      {parsed.chips.length > 0 && (
        <div className="preview-search__chips">
          {parsed.chips.map((chip) => (
            <button
              type="button"
              className="preview-qchip"
              key={`${chip.kind}-${chip.source}`}
              onClick={() => dropChip(chip)}
              title="Remove"
            >
              <b>{chip.label}</b>
              <em>{chip.field}</em>
            </button>
          ))}
        </div>
      )}

      {open && (suggestions.length > 0 || (examples && !value)) && (
        <div className="preview-search__panel">
          {suggestions.map((hit) => {
            const src = faceFor(FACE_CACHE, hit.name);
            return (
              <button type="button" className="preview-search__hit" key={hit.name} onClick={() => accept(hit)}>
                <i style={{ "--skin-tint": rarityTint(hit.rarity) } as React.CSSProperties}>
                  {src ? <img src={src} alt="" /> : <span className="preview-skin__ph" />}
                </i>
                <span>{hit.name}</span>
                {hit.rarity && <em style={{ color: rarityTint(hit.rarity) }}>{hit.rarity}</em>}
              </button>
            );
          })}
          {!value && examples?.map((example) => (
            <button type="button" className="preview-search__example" key={example} onClick={() => onChange(example)}>
              <code>{example}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
