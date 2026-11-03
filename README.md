# Security upgrade render evidence

Reviewed source head: cdeb164f56912b8f1b88cb285820965f2dca3d32.

Satori 0.25.0 to 0.33.5, Satori-scoped fflate 0.7.5, follow-redirects 1.16.1 to 1.16.2, and exact font Buffer boundaries. Default HarfBuzz shaping is retained. Tim accepted bold rendering and kerning shifts. No compatibility settings or per-string compensation.

## Audit

| Audit | Before | After |
| --- | --- | --- |
| Production | 1 high, 1 moderate | 0 |
| Full | 1 high, 7 moderate, 2 low | 6 moderate, 2 low |

After is exactly the saved baseline minus Satori GHSA-wx4j-mvgx-mqwp and follow-redirects GHSA-mrwp-f3q8-3g9p. No fflate finding. Remaining development-only packages are @hono/node-server, @shadcn/registry, @ts-morph/common, deepmerge, minimatch, shadcn, ts-morph and vite.

## Runtime

The real API used a separately seeded disposable PostgreSQL 16 database and disposable Redis 7. GET /og/trade-ups/784267566.png returned 200 image/png, 49,644 bytes, and the PNG visibly renders bold. Smoke metadata is in combined-api-smoke.json.

## Pixel comparison

Five fixed payloads were rendered directly through generateOgImage with old and new Satori. The three real payloads and production before-images were captured read-only on 2026-10-28. The final head was rendered against those same payloads. The synthetic escaping payload contains & < > quotes and a star knife name; the other synthetic payload exercises negative values and truncation.

Every image is 1200 by 630. A pixel differs if any decoded RGBA channel differs, with no tolerance. Magenta marks changed pixels.

| Payload | Old/new changed pixels | Percent | Live/new changed pixels |
| --- | ---: | ---: | ---: |
| 784267566 | 20,606 | 2.7257% | 24,400 |
| 784265956 | 9,767 | 1.2919% | 13,708 |
| 784250262 | 17,899 | 2.3676% | 23,190 |
| 900000001, escaping and knife | 11,990 | 1.5860% | n/a |
| 900000002, negative and truncated | 18,489 | 2.4456% | n/a |

HarfBuzz changes kerning and glyph positions. The Buffer correction restores separate regular and bold vendored fonts. Production before-images use lighter weights, while the final image renders the requested bold weights. These visible differences are intentional and approved. Colors, card structure, labels, and payload values are unchanged.

The unmodified old loader failed under default Node 24 pooling. For the old direct renders, Buffer.poolSize was set to zero before importing the unchanged renderer, so old font data was exactly bounded. That baseline uses the intended distinct font weights; it is not a successful default-pool baseline startup. The new renders and API smoke use normal pooling with the Buffer fix. Production allocator state was not inspected.

These files are runtime evidence only. They are not part of the source PR diff.
