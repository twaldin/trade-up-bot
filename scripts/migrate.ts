import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { migrateTables, MigrationLockTimeoutError } from "../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.replace(/\r$/, "").match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

/** Applied on the migration session before any DDL. A blocked statement fails as 55P03. */
export const MIGRATE_LOCK_TIMEOUT_SQL = "SET lock_timeout = '5s'";

async function main(): Promise<number> {
  loadEnv();
  const connectionString = process.env.DATABASE_URL
    || "postgresql://localhost:5432/tradeupbot";
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 15_000,
  });
  try {
    await migrateTables(pool, { lockTimeoutSql: MIGRATE_LOCK_TIMEOUT_SQL });
    return 0;
  } catch (err) {
    if (err instanceof MigrationLockTimeoutError) {
      console.error(err.message);
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await pool.end();
  }
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
