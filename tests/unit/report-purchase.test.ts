import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { reportPurchase } from "../../src/lib/purchase.js";
import { installBrowser, memoryStorage, type MemoryStorage } from "../helpers/browser-stub.js";

let gtag: Mock<NonNullable<typeof globalThis.gtag>>;
let fbq: Mock<NonNullable<typeof globalThis.fbq>>;

function stubCheckoutSession(body: Record<string, unknown>, status = 200) {
  const fetchSpy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
  fbq = vi.fn<NonNullable<typeof globalThis.fbq>>();
  globalThis.gtag = gtag;
  globalThis.fbq = fbq;
  installBrowser({ pathname: "/", search: "?upgraded=pro&session_id=cs_test_1" });
});

afterEach(() => {
  globalThis.gtag = undefined;
  globalThis.fbq = undefined;
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

describe("reportPurchase", () => {
  it("fires the legacy GA4 purchase once per session when nothing is configured", async () => {
    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD" });
    await reportPurchase("pro", "cs_test_1");
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][1]).toBe("purchase");
    expect(fbq).not.toHaveBeenCalled();
  });

  it("leaves GA4 purchase to the webhook when the server says it sends it, but still fires the Pixel", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD", ga4_server_side: true });
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).toHaveBeenCalledWith("track", "Purchase", expect.objectContaining({ value: 6.99 }), { eventID: "purchase_cs_test_1" });
  });

  it("does not double-count when a second tab starts before the first finishes", async () => {
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => pending));
    const first = reportPurchase("pro", "cs_test_1");
    const second = reportPurchase("pro", "cs_test_1");
    release(new Response(JSON.stringify({ transaction_id: "cs_test_1", value: 6.99, currency: "USD" }), { status: 200 }));
    await first;
    await second;
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("lets a pending flag older than 2 minutes through and keeps a fresh one", async () => {
    window.localStorage.setItem("tub_purchase_cs_test_1", `pending:${Date.now() - 90_000}`);
    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD" });
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).not.toHaveBeenCalled();

    window.localStorage.setItem("tub_purchase_cs_test_1", `pending:${Date.now() - 121_000}`);
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("clears the pending flag on a non-2xx response and on a fetch failure so a retry can report", async () => {
    stubCheckoutSession({ error: "Not paid" }, 409);
    await reportPurchase("pro", "cs_test_1");
    expect(window.localStorage.getItem("tub_purchase_cs_test_1")).toBeNull();
    expect(gtag).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw new Error("network"); }));
    await reportPurchase("pro", "cs_test_1");
    expect(window.localStorage.getItem("tub_purchase_cs_test_1")).toBeNull();

    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD" });
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("reports nothing for an unverified session", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    stubCheckoutSession({ error: "Not paid" }, 409);
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });
});

interface TabWindow {
  localStorage: MemoryStorage;
  navigator: { locks?: SharedLocks };
}

interface SharedLocks {
  request(name: string, options: { mode: "exclusive" }, callback: () => Promise<void>): Promise<void>;
}

/** One lock queue shared by every tab, the way the browser shares navigator.locks. */
function sharedLocks(): SharedLocks {
  const tails = new Map<string, Promise<void>>();
  return {
    async request(name, _options, callback) {
      const prev = tails.get(name) ?? Promise.resolve();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      tails.set(name, prev.then(() => gate));
      await prev;
      try {
        await callback();
      } finally {
        release();
      }
    },
  };
}

function tabWindow(storage: MemoryStorage, locks?: SharedLocks): TabWindow {
  return { localStorage: storage, navigator: locks ? { locks } : {} };
}

const paid = { transaction_id: "cs_test_1", value: 6.99, currency: "USD" };

describe("purchase dedupe across two tabs", () => {
  beforeEach(() => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
  });

  it("fires one GA purchase and one Pixel Purchase when two tabs share a lock", async () => {
    const storage = memoryStorage();
    const locks = sharedLocks();
    const tabA = tabWindow(storage, locks);
    const tabB = tabWindow(storage, locks);
    let fetches = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      fetches += 1;
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      return new Response(JSON.stringify(paid), { status: 200 });
    }));

    vi.stubGlobal("window", tabA);
    const first = reportPurchase("pro", "cs_test_1");
    vi.stubGlobal("window", tabB);
    const second = reportPurchase("pro", "cs_test_1");
    await Promise.all([first, second]);

    expect(fetches).toBe(1);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][1]).toBe("purchase");
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][1]).toBe("Purchase");
    expect(storage.getItem("tub_purchase_cs_test_1")).toBe("1");
  });

  it("fires once on the fallback path when two tabs do not have navigator.locks", async () => {
    const storage = memoryStorage();
    const tabA = tabWindow(storage);
    const tabB = tabWindow(storage);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(paid), { status: 200 })));

    vi.stubGlobal("window", tabA);
    const first = reportPurchase("pro", "cs_test_1");
    vi.stubGlobal("window", tabB);
    const second = reportPurchase("pro", "cs_test_1");
    await Promise.all([first, second]);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][1]).toBe("Purchase");
  });

  it("does not overwrite a finished claim when the first getItem was stale", async () => {
    const storage = memoryStorage();
    let reads = 0;
    const realGet = storage.getItem.bind(storage);
    storage.getItem = (key) => {
      if (key !== "tub_purchase_cs_test_1") return realGet(key);
      reads += 1;
      return reads === 1 ? null : "1";
    };
    const written: string[] = [];
    const realSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      written.push(value);
      realSet(key, value);
    };
    vi.stubGlobal("window", tabWindow(storage));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(paid), { status: 200 })));
    await reportPurchase("pro", "cs_test_1");
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(written).toEqual([]);
    expect(gtag).not.toHaveBeenCalled();
    expect(storage.getItem("tub_purchase_cs_test_1")).toBe("1");
  });

  it("does not fire when another tab replaces the claim token during the fallback wait", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      vi.stubGlobal("window", tabWindow(storage));
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(paid), { status: 200 })));
      const pending = reportPurchase("pro", "cs_test_1");
      await vi.advanceTimersByTimeAsync(0);
      const stolen = `pending:${Date.now()}:other-tab`;
      storage.setItem("tub_purchase_cs_test_1", stolen);
      await vi.advanceTimersByTimeAsync(200);
      await pending;
      expect(gtag).not.toHaveBeenCalled();
      expect(fbq).not.toHaveBeenCalled();
      expect(storage.getItem("tub_purchase_cs_test_1")).toBe(stolen);
    } finally {
      vi.useRealTimers();
    }
  });
});
