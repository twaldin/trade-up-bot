import { afterEach, describe, expect, it } from "vitest";
import {
  PUBLIC_BOARD_SORTS,
  boardWarmBackoffMs,
  clearsTradeUpLists,
  publicBoardWarmPaths,
  registerBoardWarmer,
  requestBoardWarm,
  resetBoardWarmerForTests,
  setBoardWarmDelayForTests,
} from "../../server/routes/board-warm.js";

describe("public board warm", () => {
  afterEach(() => {
    resetBoardWarmerForTests();
  });

  it("warms the public sorts, including created, and the homepage teaser", () => {
    const paths = publicBoardWarmPaths();
    expect(PUBLIC_BOARD_SORTS).toEqual(["trade_up_score", "profit", "roi", "cost", "chance", "created"]);
    for (const sort of PUBLIC_BOARD_SORTS) {
      expect(paths).toContain(
        `/api/trade-ups?per_page=12&sort=${sort}&order=desc&page=1&include=outcomes,inputs`,
      );
    }
    expect(paths).toContain(
      "/api/trade-ups?per_page=3&sort=trade_up_score&order=desc&page=1&include=outcomes,inputs",
    );
  });

  it("treats a tu: flush as a list clear and ignores other prefixes", () => {
    expect(clearsTradeUpLists("tu:")).toBe(true);
    expect(clearsTradeUpLists("tu_inputs:42")).toBe(false);
  });

  it("single-flights a warm and runs once more when a clear lands mid-warm", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const gate: { finish: () => void } = { finish: () => undefined };
    registerBoardWarmer(() => new Promise<void>((resolve) => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      gate.finish = () => {
        active -= 1;
        resolve();
      };
    }));

    requestBoardWarm();
    requestBoardWarm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(1);
    expect(maxActive).toBe(1);

    gate.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
    expect(maxActive).toBe(1);
  });

  it("backs off after a warmer failure instead of retrying immediately", async () => {
    expect(boardWarmBackoffMs(1)).toBe(1000);
    expect(boardWarmBackoffMs(2)).toBe(2000);
    expect(boardWarmBackoffMs(3)).toBe(4000);
    expect(boardWarmBackoffMs(7)).toBe(60_000);

    const waits: number[] = [];
    setBoardWarmDelayForTests(async (ms) => {
      waits.push(ms);
    });
    let runs = 0;
    registerBoardWarmer(async () => {
      runs += 1;
      if (runs === 1) throw new Error("warm failed");
    });

    requestBoardWarm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
    expect(waits).toEqual([1000]);
  });
});
