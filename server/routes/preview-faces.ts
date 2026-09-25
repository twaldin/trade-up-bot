import { Router } from "express";
import type pg from "pg";
import { dopplerBaseName, withDopplerFaces } from "../../shared/doppler-face.js";

const MAX_NAMES = 80;

export function parseFaceNames(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const names = raw.split("||").map((n) => n.trim()).filter(Boolean);
  return [...new Set(names)].slice(0, MAX_NAMES);
}

export function facesFromRows(rows: Array<{ name: string; image_url: string | null }>): Record<string, string | null> {
  const faces: Record<string, string | null> = {};
  for (const row of rows) {
    faces[row.name] = row.image_url;
  }
  return faces;
}

/** Names the board would otherwise send to GET /api/preview/faces. */
export function faceNamesOnPage(rows: ReadonlyArray<{ inputs?: ReadonlyArray<{ skin_name?: string }>; outcomes?: ReadonlyArray<{ skin_name?: string }> }>): string[] {
  const names: string[] = [];
  for (const row of rows) {
    for (const input of row.inputs ?? []) if (input.skin_name) names.push(input.skin_name);
    for (const outcome of row.outcomes ?? []) if (outcome.skin_name) names.push(outcome.skin_name);
  }
  return [...new Set(names)];
}

export async function loadFaceMap(pool: pg.Pool, names: readonly string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(names.filter(Boolean))].slice(0, 500);
  if (unique.length === 0) return {};
  const lookup = [...new Set([
    ...unique,
    ...unique.map((name) => dopplerBaseName(name)).filter((name): name is string => name != null),
  ])].slice(0, 500);
  const { rows } = await pool.query<{ name: string; image_url: string | null }>(
    `SELECT name, image_url FROM skins WHERE name = ANY($1::text[])`,
    [lookup],
  );
  return withDopplerFaces(unique, facesFromRows(rows));
}

export function previewFacesRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/api/preview/faces", async (req, res) => {
    const names = parseFaceNames(req.query.names);
    if (names.length === 0) {
      res.json({ faces: {} });
      return;
    }
    try {
      const lookup = [...new Set([
        ...names,
        ...names.map((name) => dopplerBaseName(name)).filter((name): name is string => name != null),
      ])];
      const { rows } = await pool.query<{ name: string; image_url: string | null }>(
        `SELECT name, image_url FROM skins WHERE name = ANY($1::text[])`,
        [lookup],
      );
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ faces: withDopplerFaces(names, facesFromRows(rows)) });
    } catch {
      res.json({ faces: {} });
    }
  });

  return router;
}
