import { useEffect, useState } from "react";
import { lookupPreviewSkinImages } from "../preview/images/client-skin-images.js";

/** Batch-lookup stored `skins.image_url` values, then ByMykel/Steam. Missing names stay null. */
export function useSkinImages(names: string[]): Map<string, string | null> {
  const [images, setImages] = useState<Map<string, string | null>>(() => new Map());
  const key = names.join("||");

  useEffect(() => {
    const wanted = key.split("||").filter(Boolean);
    if (wanted.length === 0) return;

    const unknown = wanted.filter(name => !images.has(name));
    if (unknown.length === 0) return;

    const controller = new AbortController();
    lookupPreviewSkinImages(unknown)
      .then(resolved => {
        if (controller.signal.aborted) return;
        setImages(prev => {
          const next = new Map(prev);
          for (const name of unknown) {
            if (!next.has(name)) next.set(name, resolved.get(name) ?? null);
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
