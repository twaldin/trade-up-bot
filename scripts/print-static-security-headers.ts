import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { staticHtmlSecurityHeaders } from "../server/security-headers.js";
import { applyDotenv } from "./lib/dotenv-file.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
// Same quote handling as dotenvx, which the api runs under. A quoted
// GA4_MEASUREMENT_ID used to stay quoted here and drop the GA4 CSP hosts.
if (existsSync(envPath)) applyDotenv(readFileSync(envPath, "utf-8"));

process.stdout.write(JSON.stringify(staticHtmlSecurityHeaders()));
