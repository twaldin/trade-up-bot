import type { NextFunction, Request, Response } from "express";

/** Unmatched /api paths must not fall through to the SPA HTML catch-all. */
export function unknownApiJson404(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
