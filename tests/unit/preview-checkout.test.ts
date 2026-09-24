import { describe, expect, it, vi } from "vitest";
import { runCheckout } from "../../src/preview/lib/checkout.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("runCheckout", () => {
  it("shows the 409 error and does not fire begin_checkout", async () => {
    const track = vi.fn();
    const go = vi.fn();
    const fetchImpl = vi.fn(async () => json(409, { error: "You already have Pro access. Manage your subscription instead of starting a new checkout." }));
    const result = await runCheckout("pro", { fetchImpl, track, go });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/Manage your subscription/);
    expect(track).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("does not fire begin_checkout on a 500", async () => {
    const track = vi.fn();
    const result = await runCheckout("pro-yearly", {
      fetchImpl: async () => json(500, { error: "Failed to create checkout session" }),
      track,
      go: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to create checkout session");
    expect(track).not.toHaveBeenCalled();
  });

  it("fires begin_checkout once and follows the url on success", async () => {
    const track = vi.fn();
    const go = vi.fn();
    const result = await runCheckout("pro", {
      fetchImpl: async () => json(200, { url: "https://checkout.stripe.test/cs_ok" }),
      track,
      go,
    });
    expect(result.ok).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("begin_checkout", { item_name: "pro" });
    expect(go).toHaveBeenCalledWith("https://checkout.stripe.test/cs_ok");
  });
});
