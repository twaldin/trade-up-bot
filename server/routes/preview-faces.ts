import { Router } from "express";
import type pg from "pg";

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

export function previewFacesRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/api/preview/faces", async (req, res) => {
    const names = parseFaceNames(req.query.names);
    if (names.length === 0) {
      res.json({ faces: {} });
      return;
    }
    try {
      const { rows } = await pool.query<{ name: string; image_url: string | null }>(
        `SELECT name, image_url FROM skins WHERE name = ANY($1::text[])`,
        [names],
      );
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ faces: facesFromRows(rows) });
    } catch {
      res.json({ faces: {} });
    }
  });

  return router;
}
