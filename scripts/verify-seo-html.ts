#!/usr/bin/env tsx

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedSeoRoutes, verifySeoHtml } from "./seo-html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

function routeFilePath(routePath: string): string {
  if (routePath === "/") return join(DIST_DIR, "index.html");
  return join(DIST_DIR, routePath, "index.html");
}

const issues = expectedSeoRoutes().flatMap((route) => {
  const file = routeFilePath(route.path);
  if (!existsSync(file)) {
    return [{ route: route.path, file, message: "expected prerendered HTML file to exist" }];
  }
  return verifySeoHtml(route, file, readFileSync(file, "utf-8"));
});

if (issues.length > 0) {
  console.error("SEO HTML verification failed:");
  for (const issue of issues) {
    console.error(`- ${issue.route} (${issue.file}): ${issue.message}`);
  }
  process.exit(1);
}

console.log(`SEO HTML verification passed for ${expectedSeoRoutes().length} routes.`);
