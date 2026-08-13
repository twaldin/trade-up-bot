#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
let client;

try {
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required; the daily fire will not weaken or skip integration gates");
  const parsed = new URL(connectionString);
  const configuredDatabase = decodeURIComponent(parsed.pathname.slice(1));
  if (configuredDatabase !== "tradeupbot_test") {
    throw new Error(`TEST_DATABASE_URL must select the dedicated tradeupbot_test database, not ${configuredDatabase || "an empty name"}`);
  }

  client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  const result = await client.query("SELECT current_database() AS database, current_user AS role");
  const observed = result.rows[0];
  if (observed?.database !== "tradeupbot_test" || observed?.role !== "tradeupbot_test") {
    throw new Error(`test database identity mismatch: database=${observed?.database ?? "missing"} role=${observed?.role ?? "missing"}`);
  }
  process.stdout.write("test database preflight passed: database=tradeupbot_test role=tradeupbot_test\n");
} catch (error) {
  process.stderr.write(`test database preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
