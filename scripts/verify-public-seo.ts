#!/usr/bin/env tsx

import { expectedSeoRoutes } from "./seo-html.js";

const DEFAULT_ROUTES = [
  "/",
  "/trade-ups",
  "/calculator",
  "/faq",
  "/features",
  "/pricing",
  "/blog",
  "/blog/how-cs2-trade-ups-work/",
  "/blog/cs2-trade-up-calculator-guide/",
  "/skins/ak-47-redline",
  "/trade-ups/collection/dreams-nightmares",
];

const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const baseUrl = process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? "https://tradeupbot.app";
const routesArg = process.argv.find((arg) => arg.startsWith("--routes="))?.slice("--routes=".length);
const routes = routesArg ? routesArg.split(",").filter(Boolean) : DEFAULT_ROUTES;

const expectedByPath = new Map(expectedSeoRoutes().map((route) => [route.path, route]));

function firstMatch(html: string, regex: RegExp): string | null {
  return html.match(regex)?.[1] ?? null;
}

function expectedTitleForRoute(route: string): string | undefined {
  const normalized = route === "/" ? "/" : route.replace(/\/$/, "");
  if (normalized === "/trade-ups") return "Profitable CS2 Trade-Ups — Live Contracts from Real Listings | TradeUpBot";
  if (normalized.startsWith("/skins/")) return undefined;
  if (normalized.startsWith("/trade-ups/collection/")) return undefined;
  return expectedByPath.get(normalized)?.title;
}

const failures: string[] = [];

for (const route of routes) {
  const url = new URL(route, baseUrl).toString();
  const response = await fetch(url, {
    headers: {
      "user-agent": GOOGLEBOT_UA,
      "accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    failures.push(`${route}: HTTP ${response.status}`);
    continue;
  }

  const html = await response.text();
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const canonical = firstMatch(html, /<link\s+rel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i);
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const expectedTitle = expectedTitleForRoute(route);

  if (!title) failures.push(`${route}: missing title`);
  if (!canonical) failures.push(`${route}: missing canonical`);
  if (!h1) failures.push(`${route}: missing h1`);
  if (expectedTitle && title !== expectedTitle.replace(/&/g, "&amp;")) {
    failures.push(`${route}: title mismatch: ${title}`);
  }

  console.log(`${route} ${response.status} title=${title ?? "missing"} canonical=${canonical ?? "missing"}`);
}

if (failures.length > 0) {
  console.error("\nPublic SEO verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nPublic SEO verification passed for ${routes.length} Googlebot fetches.`);
