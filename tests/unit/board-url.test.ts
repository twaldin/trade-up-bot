import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import {
  boardSearchFromState,
  readBoardLocation,
  replaceBoardUrl,
  stateFromBoardSearch,
  type BoardUrlState,
} from "../../src/preview/lib/board-url.js";
import { loosenSuggestion } from "../../src/preview/lib/empty-suggestions.js";
import { EXPECTED_PL_HELP, ExpectedPlHelp } from "../../src/preview/components/ExpectedPlHelp.js";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function roundTrip(state: BoardUrlState): BoardUrlState {
  return stateFromBoardSearch(boardSearchFromState(state));
}

describe("board URL", () => {
  it("round-trips filter and sort state through the list API param names", () => {
    const state: BoardUrlState = {
      query: {
        ...DEFAULT_QUERY,
        type: "covert_knife",
        minChance: "80",
        maxCost: "20",
        minProfit: "1.5",
        skin: "AK-47 | Redline",
        sort: "cost",
        order: "asc",
      },
      text: "classified <$50",
    };
    const search = boardSearchFromState(state);
    const params = new URLSearchParams(search);
    expect(params.get("type")).toBe("covert_knife");
    expect(params.get("min_chance")).toBe("80");
    expect(params.get("max_cost")).toBe("2000");
    expect(params.get("min_profit")).toBe("150");
    expect(params.get("sort")).toBe("cost");
    expect(params.get("order")).toBe("asc");
    expect(params.get("q")).toBe("classified <$50");
    expect(roundTrip(state)).toEqual(state);
  });

  it("keeps the default board on a bare /trade-ups path", () => {
    expect(boardSearchFromState({ query: { ...DEFAULT_QUERY }, text: "" })).toBe("");
    expect(readBoardLocation({ pathname: "/trade-ups", search: "" })).toEqual({
      query: { ...DEFAULT_QUERY },
      text: "",
    });
  });

  it("ignores unknown and invalid params and clamps chance", () => {
    const state = stateFromBoardSearch("?min_chance=150&min_chance_extra=1&sort=drop_table&order=sideways&max_cost=nope&type=nope&bogus=1&ref=friend");
    expect(state.query.minChance).toBe("100");
    expect(state.query.sort).toBe("trade_up_score");
    expect(state.query.order).toBe("desc");
    expect(state.query.maxCost).toBe("");
    expect(state.query.type).toBe("");
    expect(state.text).toBe("");
    const written = boardSearchFromState(state, "?bogus=1&ref=friend&min_chance=150");
    const params = new URLSearchParams(written);
    expect(params.get("min_chance")).toBe("100");
    expect(params.get("bogus")).toBe("1");
    expect(params.get("ref")).toBe("friend");
    expect(params.get("sort")).toBeNull();
    expect(params.has("drop_table")).toBe(false);
  });

  it("does not read filters off another route", () => {
    expect(readBoardLocation({ pathname: "/skins", search: "?min_chance=80" }).query.minChance).toBe("");
    expect(readBoardLocation(null).text).toBe("");
  });

  it("replaceState writes the filtered URL and does not push", () => {
    const calls: string[] = [];
    const history = {
      state: { idx: 1 },
      replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
        calls.push(String(url));
      },
      pushState: () => { throw new Error("push"); },
    };
    const location = { pathname: "/trade-ups", search: "" };
    replaceBoardUrl({
      query: { ...DEFAULT_QUERY, minChance: "40", maxCost: "10" },
      text: "",
    }, location, history);
    expect(calls).toEqual(["/trade-ups?min_chance=40&max_cost=1000"]);
    replaceBoardUrl({ query: { ...DEFAULT_QUERY }, text: "" }, { pathname: "/trade-ups", search: "" }, history);
    expect(calls).toHaveLength(1);
    replaceBoardUrl({
      query: { ...DEFAULT_QUERY, minChance: "40" },
      text: "",
    }, { pathname: "/collections", search: "" }, history);
    expect(calls).toHaveLength(1);
  });
});

describe("empty-state suggestions", () => {
  it("raises max cost when that bound is the tightest", () => {
    const next = loosenSuggestion({ ...DEFAULT_QUERY, maxCost: "20", minChance: "10" }, "");
    expect(next?.label).toBe("Raise max cost to $40");
    expect(next?.query.maxCost).toBe("40");
    expect(next?.query.minChance).toBe("10");
  });

  it("lowers min chance when that bound is the tightest", () => {
    const next = loosenSuggestion({ ...DEFAULT_QUERY, minChance: "80", maxCost: "400" }, "");
    expect(next?.label).toBe("Lower min chance to 60%");
    expect(next?.query.minChance).toBe("60");
    expect(next?.query.maxCost).toBe("400");
  });

  it("clears a skin filter without touching the other controls", () => {
    const next = loosenSuggestion({ ...DEFAULT_QUERY, skin: "AK-47 | Redline", sort: "roi" }, "");
    expect(next?.label).toBe("Clear skin");
    expect(next?.query.skin).toBe("");
    expect(next?.query.sort).toBe("roi");
  });
});

describe("expected P/L helper", () => {
  it("renders the neutral explanation and avoids earnings claims", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, ExpectedPlHelp() as ReactNode));
    expect(html).toContain(EXPECTED_PL_HELP);
    expect(html).toContain("preview-pl-help");
    const banned = /\b(bankroll|guaranteed|plays|finish green)\b/i;
    expect(EXPECTED_PL_HELP).not.toMatch(banned);
    expect(html).not.toMatch(banned);
  });
});
