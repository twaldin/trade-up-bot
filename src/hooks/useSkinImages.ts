import { useEffect, useState } from "react";
import { isUsableImageUrl } from "../utils/skin-image.js";

/** Batch-lookup stored `skins.image_url` values. Missing names stay null. */
export function useSkinImages(names: string[]): Map<string, string | null> {
  const [images, setImages] = useState<Map<string, string | null>>(() => new Map());
  const key = names.join("||");

  useEffect(() => {
    const wanted = key.split("||").filter(Boolean);
    if (wanted.length === 0) return;

    const unknown = wanted.filter(name => !images.has(name));
    if (unknown.length === 0) return;

    const controller = new AbortController();
    fetch(`/api/skin-images?names=${encodeURIComponent(unknown.join("||"))}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : { images: {} }))
      .then((data: { images?: Record<string, string | null> }) => {
        setImages(prev => {
          const next = new Map(prev);
          for (const name of unknown) {
            const raw = data.images?.[name];
            next.set(name, isUsableImageUrl(raw) ? raw : null);
          }
          return next;
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setImages(prev => {
          const next = new Map(prev);
          for (const name of unknown) {
            if (!next.has(name)) next.set(name, null);
          }
          return next;
        });
      });

    return () => controller.abort();
    // images is read only to skip names already resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return images;
}
