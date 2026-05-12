import type { NextFunction, Request, Response } from "express";

export function redirectWwwHost(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host || "";
  const hostname = host.toLowerCase().split(":")[0];
  if (hostname === "www.tradeupbot.app") {
    res.redirect(301, `https://tradeupbot.app${req.originalUrl}`);
    return;
  }
  next();
}
