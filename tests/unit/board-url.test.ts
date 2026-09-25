import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import {
  boardSearchFromState,
  historyAction,
  pushBoardUrl,
  readBoardLocation,
  replaceBoardUrl,
  stateFromBoardSearch,
  type BoardUrlState,
} from "../../src/preview/lib/board-url.js";
import { formatSuggestionDollars, loosenCandidates } from "../../src/preview/lib/empty-suggestions.js";
import { commitMinChance } from "../../src/preview/lib/min-chance.js";
import { EXPECTED_PL_HELP, EXPECTED_PL_TOOLTIP, ExpectedPlHelp, showExpectedPlHelp } from "../../src/preview/components/ExpectedPlHelp.js";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function roundTrip(state: BoardUrlState): BoardUrlState {
  return stateFromBoardSearch(boardSearchFromState(state));
}

describe("board URL", () => {
  it("clamps a typed min chance to 0–100 on commit", () => {
    expect(commitMinChance("150")).toBe("100");
    expect(commitMinChance("-4")).toBe("0");
    expect(commitMinChance("")).toBe("");
    expect(commitMinChance("80")).toBe("80");
    const written = boardSearchFromState({ query: { ...DEFAULT_QUERY, minChance: commitMinChance("150") }, text: "" });
    expect(written).toContain("min_chance=100");
    expect(written).not.toContain("150");
  });

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

  it("round-trips collection and skin filters with the same param names", () => {
    const state = stateFromBoardSearch("?min_chance=80&max_cost=5000&sort=profit");
    expect(readBoardLocation({ pathname: "/collections/kilowatt", search: "?min_chance=80&max_cost=5000&sort=profit" })).toEqual(state);
    expect(readBoardLocation({ pathname: "/skins/ak-47-redline", search: "?min_chance=150&sort=nope" }).query).toEqual({
      ...DEFAULT_QUERY,
      minChance: "100",
    });
    const pushed: string[] = [];
    pushBoardUrl(state, { pathname: "/collections/kilowatt", search: "" }, {
      state: null,
      replaceState: () => { throw new Error("replace"); },
      pushState: (_data, _unused, url) => { pushed.push(String(url)); },
    });
    expect(pushed).toEqual(["/collections/kilowatt?min_chance=80&max_cost=5000&sort=profit"]);
  });

  it("pushes a committed change and replaces further keystrokes in that field", () => {
    expect(historyAction(null, "", "min_chance=8")).toEqual({ action: "push", field: "min_chance" });
    expect(historyAction("min_chance", "min_chance=8", "min_chance=80")).toEqual({ action: "replace", field: "min_chance" });
    expect(historyAction("min_chance", "min_chance=80", "min_chance=80&sort=profit")).toEqual({ action: "push", field: null });
  });

});

describe("empty-state suggestion candidates", () => {
  it("offers 2x, 5x, and 10x when max cost is the tightest", () => {
    const steps = loosenCandidates({ ...DEFAULT_QUERY, maxCost: "1", minChance: "10" }, "");
    expect(steps.map((step) => step.label)).toEqual([
      "Raise max cost to $2.00",
      "Raise max cost to $5.00",
      "Raise max cost to $10.00",
    ]);
    expect(steps[2].query.minChance).toBe("10");
  });

  it("walks min above cost down the fixed ladder when that bound is the tightest", () => {
    const steps = loosenCandidates({ ...DEFAULT_QUERY, minChance: "80", maxCost: "400" }, "");
    expect(steps.map((step) => step.label)).toEqual([
      "Lower min above cost to 60%",
      "Lower min above cost to 40%",
      "Lower min above cost to 20%",
    ]);
    expect(steps.map((step) => step.query.minChance)).toEqual(["60", "40", "20"]);
    expect(steps[0].query.maxCost).toBe("400");
    expect(loosenCandidates({ ...DEFAULT_QUERY, minChance: "79" }, "").map((step) => step.query.minChance)).toEqual(["60", "40", "20"]);
    expect(loosenCandidates({ ...DEFAULT_QUERY, minChance: "100" }, "").map((step) => step.query.minChance)).toEqual(["80", "60", "40"]);
    const below = loosenCandidates({ ...DEFAULT_QUERY, minChance: "15" }, "");
    expect(below.map((step) => step.label)).toEqual(["Clear min above cost"]);
    expect(below[0].query.minChance).toBe("");
  });

  it("prints money with two decimals and clears a zero min profit", () => {
    expect(formatSuggestionDollars(61.7)).toBe("$61.70");
    expect(formatSuggestionDollars(-3.2)).toBe("-$3.20");
    const steps = loosenCandidates({ ...DEFAULT_QUERY, minProfit: "123.40" }, "");
    expect(steps[0].label).toBe("Lower min profit to $61.70");
    expect(steps[0].query.minProfit).toBe("61.70");
    const cleared = loosenCandidates({ ...DEFAULT_QUERY, minProfit: "0.01" }, "");
    expect(cleared.some((step) => step.label === "Clear min profit")).toBe(true);
    expect(cleared.find((step) => step.label === "Clear min profit")?.query.minProfit).toBe("");
  });

  it("clears a skin filter without touching the other controls", () => {
    const steps = loosenCandidates({ ...DEFAULT_QUERY, skin: "AK-47 | Redline", sort: "roi" }, "");
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toBe("Clear skin");
    expect(steps[0].query.skin).toBe("");
    expect(steps[0].query.sort).toBe("roi");
  });
});

describe("expected P/L helper", () => {
  const banned = /case key|Profitable CS2 Contracts|profitable CS2 trade-ups|>Chance<|"Chance"\]|\bodds\b|chance of profit|chance to profit|chance-to-profit|% chance|\brolls?\b|bankroll|finish(?:es)? (?:in the )?green|Min chance %|Find Profitable|Live Profitable|guaranteed|jackpot|gamble|\bbet\b|win big|case opening/i;

  it("renders the explanation without a duplicate title", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, ExpectedPlHelp() as ReactNode));
    expect(html).toContain(EXPECTED_PL_HELP);
    expect(html).toContain("preview-pl-help");
    expect(html).not.toContain("title=");
    expect(showExpectedPlHelp(-100, 0.5)).toBe(true);
    expect(showExpectedPlHelp(-100, 0.49)).toBe(false);
    expect(showExpectedPlHelp(0, 0.8)).toBe(false);
    expect(showExpectedPlHelp(-100, null)).toBe(false);
  });

  it("keeps chance, odds, and roll out of the explainer, tooltip, and loosen labels", () => {
    const labels = [
      ...loosenCandidates({ ...DEFAULT_QUERY, maxCost: "1" }, ""),
      ...loosenCandidates({ ...DEFAULT_QUERY, minChance: "100" }, ""),
      ...loosenCandidates({ ...DEFAULT_QUERY, minChance: "15" }, ""),
      ...loosenCandidates({ ...DEFAULT_QUERY, minProfit: "3.20" }, ""),
      ...loosenCandidates({ ...DEFAULT_QUERY, skin: "AK-47 | Redline" }, ""),
      ...loosenCandidates(DEFAULT_QUERY, "ak"),
      ...loosenCandidates({ ...DEFAULT_QUERY, type: "classified_covert" }, ""),
    ].map((step) => step.label);
    for (const copy of [EXPECTED_PL_HELP, EXPECTED_PL_TOOLTIP, "Updating trade-ups…", ...labels]) {
      expect(copy).not.toMatch(banned);
    }
    expect("rolls").toMatch(banned);
    expect("finish in the green").toMatch(banned);
    expect("chance-to-profit").toMatch(banned);
    expect('"Chance"]').toMatch(banned);
    expect("Find Profitable").toMatch(banned);
    expect("Live Profitable").toMatch(banned);
  });
});
