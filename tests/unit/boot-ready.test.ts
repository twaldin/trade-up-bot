import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALCULATOR_WARM_LIMIT_MS,
  PM2_KILL_TIMEOUT_MS,
  PM2_LISTEN_TIMEOUT_MS,
  PROCESS_DRAIN_MS,
  warmThenListen,
} from "../../server/boot-ready.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("warm then listen", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("listens only after the warm resolves", async () => {
    const order: string[] = [];
    const outcome = await warmThenListen({
      warm: async () => {
        order.push("warm");
      },
      listen: () => {
        order.push("listen");
      },
    });
    expect(outcome).toBe("warmed");
    expect(order).toEqual(["warm", "listen"]);
  });

  it("listens once when the warm exceeds the time limit", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let listened = 0;
    const pending = warmThenListen({
      warm: () => new Promise<void>(() => {}),
      listen: () => {
        listened += 1;
      },
      limitMs: CALCULATOR_WARM_LIMIT_MS,
    });
    await vi.advanceTimersByTimeAsync(CALCULATOR_WARM_LIMIT_MS - 1);
    expect(listened).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("timed-out");
    expect(listened).toBe(1);
  });

  it("still listens when the warm throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let listened = false;
    const outcome = await warmThenListen({
      warm: async () => {
        throw new Error("warm failed");
      },
      listen: () => {
        listened = true;
      },
    });
    expect(outcome).toBe("failed");
    expect(listened).toBe(true);
  });
});

describe("pm2 ready wiring", () => {
  const index = readFileSync(join(root, "server/index.ts"), "utf8");
  const ecosystem = readFileSync(join(root, "ecosystem.config.cjs"), "utf8");

  it("sends ready from the listen callback after the calculator warm", () => {
    const warmAt = index.indexOf("await warmThenListen");
    const readyAt = index.indexOf('process.send?.("ready")');
    expect(warmAt).toBeGreaterThan(0);
    expect(readyAt).toBeGreaterThan(warmAt);
    expect(index).toContain("warm: () => warmCalculatorCaches(pool)");
    expect(index).toContain('message === "shutdown"');
    expect(index).toContain('drain("SIGINT")');
    expect(index).toContain("Number(process.env.PORT)");
  });

  it("waits longer than the warm limit and drains before kill_timeout", () => {
    expect(ecosystem).toContain('exec_mode: "cluster"');
    expect(ecosystem).toContain("instances: 1");
    expect(ecosystem).toContain("wait_ready: true");
    expect(ecosystem).toContain(`listen_timeout: ${PM2_LISTEN_TIMEOUT_MS}`);
    expect(ecosystem).toContain(`kill_timeout: ${PM2_KILL_TIMEOUT_MS}`);
    expect(PM2_LISTEN_TIMEOUT_MS).toBeGreaterThan(CALCULATOR_WARM_LIMIT_MS);
    expect(PM2_KILL_TIMEOUT_MS).toBeGreaterThan(PROCESS_DRAIN_MS);
  });
});
