import { describe, expect, it } from "vitest";
import { enqueueRebuild, resetRebuildQueueForTests } from "../../server/engine/rebuild-queue.js";

describe("rebuild queue", () => {
  it("runs one rebuild at a time and continues after a rejection", async () => {
    resetRebuildQueueForTests();
    let active = 0;
    let maxActive = 0;
    const run = (fail: boolean) => enqueueRebuild(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      if (fail) throw new Error("rebuild failed");
    });

    const first = run(true);
    const second = run(false);
    await expect(first).rejects.toThrow(/rebuild failed/);
    await second;
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });
});
