import { Router } from "express";
import pg from "pg";

/** Server-side cap for the health ping. A stuck query must not hold the check open. */
const PING_TIMEOUT = "2s";

export async function pingDatabase(pool: pg.Pool): Promise<boolean> {
  let client: pg.PoolClient | undefined;
  let failed: Error | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${PING_TIMEOUT}'`);
    await client.query("SELECT 1");
    await client.query("COMMIT");
    return true;
  } catch (err) {
    failed = err instanceof Error ? err : new Error("database ping failed");
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return false;
  } finally {
    client?.release(failed);
  }
}

export function healthRouter(pool: pg.Pool): Router {
  const router = Router();
  router.get("/api/health", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (await pingDatabase(pool)) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(503).json({ ok: false });
  });
  return router;
}
