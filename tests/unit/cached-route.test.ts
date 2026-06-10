/**
 * Unit tests for cachedRoute single-flight coalescing.
 *
 * Redis is NOT available in this environment (unit tests run without Redis).
 * Coalescing must work in front of the Redis check so it applies regardless.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

// Module state (_pending) is intentionally shared across tests — concurrent
// requests must share one in-flight execution, which is what we test.
import { cachedRoute } from "../../server/redis.js";

function makeApp(
  key: string | ((req: express.Request) => string | null),
  handler: (req: express.Request, res: express.Response, next: express.NextFunction) => void | Promise<void>,
): express.Application {
  const app = express();
  app.get("/test", cachedRoute(key, 60, handler));
  return app;
}

describe("cachedRoute single-flight coalescing", () => {
  describe("concurrent deduplication (Redis down)", () => {
    it("executes the handler exactly once when 5 concurrent requests arrive", async () => {
      let callCount = 0;

      const handler = async (_req: express.Request, res: express.Response) => {
        callCount++;
        // Simulate slow handler (100ms)
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        res.json({ n: 1 });
      };

      const app = makeApp("test_concurrent_key", handler);

      // Fire 5 concurrent requests
      const results = await Promise.all([
        request(app).get("/test"),
        request(app).get("/test"),
        request(app).get("/test"),
        request(app).get("/test"),
        request(app).get("/test"),
      ]);

      // All 5 must succeed
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ n: 1 });
      }

      // Handler must have been called exactly once
      expect(callCount).toBe(1);
    });
  });

  describe("sequential non-deduplication (Redis down)", () => {
    it("invokes the handler on each sequential request when there is no Redis cache", async () => {
      let callCount = 0;

      const handler = async (_req: express.Request, res: express.Response) => {
        callCount++;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        res.json({ n: callCount });
      };

      const app = makeApp("test_sequential_key", handler);

      // First request
      const r1 = await request(app).get("/test");
      expect(r1.status).toBe(200);
      expect(callCount).toBe(1);

      // Second request — no Redis, so no cache → handler runs again
      const r2 = await request(app).get("/test");
      expect(r2.status).toBe(200);
      expect(callCount).toBe(2);
    });
  });

  describe("error propagation — no hung waiters, pending cleaned up", () => {
    it("completes all concurrent requests even when the handler throws, and runs the handler again on subsequent request", async () => {
      let callCount = 0;

      const handler = async (_req: express.Request, res: express.Response, next: express.NextFunction) => {
        callCount++;
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        next(new Error("handler error"));
      };

      // Mount with a simple error handler so supertest doesn't hang
      const app = express();
      app.get("/test", cachedRoute("test_error_key", 60, handler));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: "caught" });
      });

      // Fire 3 concurrent requests — all should complete (error responses are fine)
      const results = await Promise.all([
        request(app).get("/test"),
        request(app).get("/test"),
        request(app).get("/test"),
      ]);

      // None should hang; status doesn't matter as long as responses arrive
      for (const r of results) {
        expect(r.status).toBeDefined();
      }

      // Failure must NOT be coalesced — subsequent request must run the handler again
      const before = callCount;
      const r4 = await request(app).get("/test");
      expect(r4.status).toBeDefined();
      expect(callCount).toBeGreaterThan(before);
    });
  });
});
