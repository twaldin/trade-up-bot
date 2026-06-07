import type { Express, RequestHandler } from "express";

const NO_TRAILING_SLASH_PATHS = new Set([
  "/blog",
  "/calculator",
  "/collections",
  "/faq",
  "/features",
  "/pricing",
  "/privacy",
  "/skins",
  "/terms",
  "/trade-ups",
]);

const NO_TRAILING_SLASH_PATTERNS = [
  /^\/collections\/[^/]+$/,
  /^\/skins\/[^/]+$/,
  /^\/trade-ups\/collection\/[^/]+$/,
  /^\/trade-ups\/\d+$/,
];

function stripTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function shouldRedirectToNoTrailingSlash(pathname: string): boolean {
  if (pathname === "/" || !pathname.endsWith("/")) return false;

  const canonicalPath = stripTrailingSlashes(pathname);
  return NO_TRAILING_SLASH_PATHS.has(canonicalPath)
    || NO_TRAILING_SLASH_PATTERNS.some((pattern) => pattern.test(canonicalPath));
}

export const canonicalRedirectHandler: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  if (!shouldRedirectToNoTrailingSlash(req.path)) {
    next();
    return;
  }

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart >= 0 ? req.originalUrl.slice(queryStart) : "";
  res.redirect(301, `${stripTrailingSlashes(req.path)}${query}`);
};

export function registerCanonicalRedirectRoutes(app: Express): void {
  app.use(canonicalRedirectHandler);
}
