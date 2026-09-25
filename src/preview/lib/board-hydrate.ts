/**
 * Per-card inputs and outcomes are still two GETs. PR #157 owns batching them
 * into the list response. Until then a 429 must not leave the card bare:
 * retry each call once, then say so on the card.
 */

import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { noteRateLimited, parseRetryAfter, rateLimitWaitMs, waitForBrowseHold } from "./page-fetch.js";

export interface HydratedTradeUp extends TradeUp {
  /** Set when an inputs or outcomes fetch stayed 429 after one retry. */
  hydrateThrottled?: boolean;
}

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

async function readDetail(
  url: string,
  fetchFn: typeof fetch,
  sleep: Sleep,
): Promise<{ throttled: boolean; data: unknown }> {
  const load = async () => {
    try {
      return await fetchFn(url, { credentials: "include" });
    } catch {
      return null;
    }
  };

  await waitForBrowseHold();
  const first = await load();
  if (!first) return { throttled: false, data: null };
  if (first.status !== 429) {
    if (!first.ok) return { throttled: false, data: null };
    return { throttled: false, data: await first.json().catch(() => null) };
  }

  const retryAfter = parseRetryAfter(first.headers.get("retry-after"));
  noteRateLimited(retryAfter);
  await sleep(rateLimitWaitMs(0, retryAfter));

  const second = await load();
  if (!second || second.status === 429) {
    if (second?.status === 429) noteRateLimited(parseRetryAfter(second.headers.get("retry-after")));
    return { throttled: true, data: null };
  }
  if (!second.ok) return { throttled: false, data: null };
  return { throttled: false, data: await second.json().catch(() => null) };
}

export async function hydrateBoardCard(
  tu: TradeUp,
  fetchFn: typeof fetch = fetch,
  sleep: Sleep = defaultSleep,
): Promise<HydratedTradeUp> {
  let next: HydratedTradeUp = tu;
  let throttled = false;

  if (tu.outcomes.length === 0) {
    const read = await readDetail(`/api/trade-up/${tu.id}/outcomes`, fetchFn, sleep);
    throttled = throttled || read.throttled;
    const outcomes = outcomeRows(read.data);
    if (outcomes) next = { ...next, outcomes };
  }

  if (tu.inputs.length === 0) {
    const read = await readDetail(`/api/trade-up/${tu.id}/inputs`, fetchFn, sleep);
    throttled = throttled || read.throttled;
    const inputs = inputRows(read.data);
    if (inputs) next = { ...next, inputs };
  }

  if (!throttled) return clearHydrateThrottle(next);
  return { ...clearHydrateThrottle(next), hydrateThrottled: true };
}

function clearHydrateThrottle(tu: HydratedTradeUp): HydratedTradeUp {
  if (!tu.hydrateThrottled) return tu;
  const copy: HydratedTradeUp = { ...tu };
  delete copy.hydrateThrottled;
  return copy;
}

function outcomeRows(data: unknown): TradeUpOutcome[] | null {
  if (!data || typeof data !== "object" || !("outcomes" in data)) return null;
  const outcomes = data.outcomes;
  return Array.isArray(outcomes) ? outcomes as TradeUpOutcome[] : null;
}

function inputRows(data: unknown): TradeUpInput[] | null {
  if (!data || typeof data !== "object" || !("inputs" in data)) return null;
  const inputs = data.inputs;
  return Array.isArray(inputs) ? inputs as TradeUpInput[] : null;
}
