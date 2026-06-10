/**
 * Unit tests for ObservationBuffer (Skinport WS micro-batch buffer).
 * Exercises size-triggered flush, timer-triggered flush, and flush failure handling.
 */

import { describe, it, expect, vi } from "vitest";
import { ObservationBuffer, type ObsRow } from "../../server/sync/observation-buffer.js";

describe("ObservationBuffer", () => {
  it("does not flush when fewer than maxRows rows pushed", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 50, 500);

      // Push 49 rows — no flush should occur
      for (let i = 0; i < 49; i++) {
        buf.push({ skinName: "AK-47 | Redline", floatValue: 0.1 + i * 0.001, priceCents: 1000 + i });
      }

      expect(flushed).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("flushes immediately when maxRows rows are pushed (50th push triggers flush)", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 50, 500);

      for (let i = 0; i < 50; i++) {
        buf.push({ skinName: "AK-47 | Redline", floatValue: 0.1 + i * 0.001, priceCents: 1000 + i });
      }

      // Flush is triggered synchronously on the 50th push, async fn runs as microtask
      await vi.advanceTimersByTimeAsync(0);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(50);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("flushes via timer after maxMs even when buffer is under maxRows", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 50, 500);

      buf.push({ skinName: "AK-47 | Redline", floatValue: 0.15, priceCents: 2000 });
      buf.push({ skinName: "M4A4 | Howl", floatValue: 0.05, priceCents: 5000 });

      // Before timer fires — no flush
      await vi.advanceTimersByTimeAsync(499);
      expect(flushed).toHaveLength(0);

      // After timer fires
      await vi.advanceTimersByTimeAsync(1);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(2);
      expect(flushed[0][0].skinName).toBe("AK-47 | Redline");
      expect(flushed[0][1].skinName).toBe("M4A4 | Howl");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("drops the batch on flush failure without throwing, logs at most once per minute", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let callCount = 0;
      const buf = new ObservationBuffer(async () => {
        callCount++;
        throw new Error("DB down");
      }, 50, 500);

      // First flush — triggers first error log
      for (let i = 0; i < 50; i++) {
        buf.push({ skinName: "AK-47 | Redline", floatValue: 0.1 + i * 0.001, priceCents: 1000 });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);
      expect(errSpy).toHaveBeenCalledTimes(1);

      // Second flush within 1 minute — should NOT log again
      for (let i = 0; i < 50; i++) {
        buf.push({ skinName: "AK-47 | Redline", floatValue: 0.1 + i * 0.001, priceCents: 1000 });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(2);
      expect(errSpy).toHaveBeenCalledTimes(1); // Still 1 — throttled
    } finally {
      errSpy.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("drain flushes remaining rows immediately", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 50, 500);

      buf.push({ skinName: "AK-47 | Redline", floatValue: 0.15, priceCents: 2000 });

      // Timer not fired yet — call drain
      await buf.drain();

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("drain does nothing when buffer is empty", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 50, 500);
      await buf.drain();
      expect(flushed).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("timer is cleared after size-triggered flush, does not double-flush", async () => {
    vi.useFakeTimers();
    try {
      const flushed: ObsRow[][] = [];
      const buf = new ObservationBuffer(async (rows) => { flushed.push(rows); }, 3, 500);

      buf.push({ skinName: "A", floatValue: 0.1, priceCents: 100 });
      buf.push({ skinName: "B", floatValue: 0.2, priceCents: 200 });
      buf.push({ skinName: "C", floatValue: 0.3, priceCents: 300 }); // triggers size flush

      await vi.advanceTimersByTimeAsync(0); // drain the microtask
      expect(flushed).toHaveLength(1);

      // Advance past maxMs — timer was cleared so no extra flush
      await vi.advanceTimersByTimeAsync(600);
      expect(flushed).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
