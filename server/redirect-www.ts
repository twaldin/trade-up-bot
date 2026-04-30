import type { NextFunction, Request, Response } from "express";

export function redirectWwwHost(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host || "";
  if (host.toLowerCase() === "www.tradeupbot.app") {
    res.redirect(301, `https://tradeupbot.app${req.originalUrl}`);
    return;
  }
  next();
}
