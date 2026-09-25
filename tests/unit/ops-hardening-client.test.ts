import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { installDaemonLogTee } from "../../server/daemon/log-tee.js";
import { AUTH_ME_TIMEOUT_MS, fetchPricingSession } from "../../src/preview/lib/auth-state.js";

describe("stale purge comment", () => {
  it("describes noindex,follow until the 24h purge, then 404", () => {
    const source = readFileSync(new URL("../../server/daemon/phases/housekeeping.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/never delete/i);
    expect(source).toContain("noindex,follow");
    expect(source).toContain("24h");
    expect(source).toContain("404");
    expect(source).toContain("purgeExpiredPreserved(pool, 1)");
  });
});

describe("20x recheck after output reprice", () => {
  it("calls markTradeUpsCostOver20xEv after Phase 4c and before Phase 5", () => {
    const source = readFileSync(new URL("../../server/daemon/index.ts", import.meta.url), "utf8");
    const reprice = source.indexOf("Phase 4c: Repriced");
    const phase5 = source.indexOf("Phase 5: Time-Bounded Engine");
    const between = source.slice(reprice, phase5);
    expect(reprice).toBeGreaterThan(0);
    expect(between).toContain("markTradeUpsCostOver20xEv");
    expect(between).toContain("Marked ${markedOver20x} trade-ups stale (cost > 20x EV)");
    const housekeeping = readFileSync(new URL("../../server/daemon/phases/housekeeping.ts", import.meta.url), "utf8");
    expect(housekeeping).toContain("total_cost_cents > 20 * GREATEST(expected_value_cents, 1)");
  });
});

describe("daemon log tee", () => {
  it("writes each stdout chunk to the file once, even if install runs twice", () => {
    const file = path.join(os.tmpdir(), `daemon-tee-${process.pid}-${Date.now()}.log`);
    const stop = installDaemonLogTee(file);
    installDaemonLogTee(file);
    try {
      process.stdout.write("Marked 12921\n");
    } finally {
      stop();
    }
    const text = fs.readFileSync(file, "utf8");
    expect(text.match(/Marked 12921/g)).toHaveLength(1);
    fs.unlinkSync(file);
  });
});

describe("pricing auth timeout", () => {
  it("uses an 8s timeout and falls back to logged out when /api/auth/me hangs", async () => {
    expect(AUTH_ME_TIMEOUT_MS).toBe(8000);
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    const pending = fetchPricingSession(fetchImpl as typeof fetch, AUTH_ME_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(7999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("returns the session when auth/me answers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steam_id: "s", tier: "pro", lifetime: false }), { status: 200 }));
    await expect(fetchPricingSession(fetchImpl as typeof fetch, 50)).resolves.toEqual({
      steam_id: "s",
      tier: "pro",
      lifetime: false,
    });
  });
});
