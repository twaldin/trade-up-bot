import { describe, expect, it } from "vitest";
import {
  lifetimeCheckoutAction,
  lifetimeGrantMatchesFailure,
  subscriptionTierChangeAllowed,
  tierAfterLifetimeRevoke,
  tierForSubscriptionEvent,
  tierFromSubscription,
} from "../../server/stripe-entitlement.js";

const PRICES = { pro: "price_pro", yearly: "price_year", basic: "price_basic" };

describe("lifetime checkout fulfillment", () => {
  it("grants a completed checkout only when payment_status is paid or no_payment_required", () => {
    expect(lifetimeCheckoutAction("checkout.session.completed", "paid")).toBe("grant");
    expect(lifetimeCheckoutAction("checkout.session.completed", "no_payment_required")).toBe("grant");
  });

  it("ignores an unpaid completion", () => {
    expect(lifetimeCheckoutAction("checkout.session.completed", "unpaid")).toBe("ignore");
    expect(lifetimeCheckoutAction("checkout.session.completed", null)).toBe("ignore");
  });

  it("grants on async_payment_succeeded even if the session still says unpaid", () => {
    expect(lifetimeCheckoutAction("checkout.session.async_payment_succeeded", "unpaid")).toBe("grant");
    expect(lifetimeCheckoutAction("checkout.session.async_payment_succeeded", "paid")).toBe("grant");
  });

  it("revokes on async_payment_failed", () => {
    expect(lifetimeCheckoutAction("checkout.session.async_payment_failed", "unpaid")).toBe("revoke");
  });
});

describe("tier after a failed lifetime payment", () => {
  it("keeps an admin on their current tier", () => {
    expect(tierAfterLifetimeRevoke({ is_admin: true, tier: "pro" }, [], PRICES)).toBe("pro");
    expect(tierAfterLifetimeRevoke(
      { is_admin: true, tier: "pro" },
      [{ status: "canceled", priceId: "price_pro" }],
      PRICES,
    )).toBe("pro");
  });

  it("keeps pro when an active monthly subscription remains", () => {
    expect(tierAfterLifetimeRevoke(
      { is_admin: false, tier: "pro" },
      [{ status: "active", priceId: "price_pro" }],
      PRICES,
    )).toBe("pro");
    expect(tierAfterLifetimeRevoke(
      { is_admin: false, tier: "pro" },
      [{ status: "trialing", priceId: "price_pro" }],
      PRICES,
    )).toBe("pro");
  });

  it("revokes only the checkout session that granted lifetime", () => {
    const grant = { checkoutSessionId: "cs_A", paymentIntentId: "pi_A" };
    expect(lifetimeGrantMatchesFailure(grant, { checkoutSessionId: "cs_A", paymentIntentId: "pi_A" })).toBe(true);
    expect(lifetimeGrantMatchesFailure(grant, { checkoutSessionId: "cs_B", paymentIntentId: "pi_A" })).toBe(true);
    expect(lifetimeGrantMatchesFailure(grant, { checkoutSessionId: "cs_B", paymentIntentId: "pi_B" })).toBe(false);
    expect(lifetimeGrantMatchesFailure(undefined, { checkoutSessionId: "cs_A", paymentIntentId: "pi_A" })).toBe(false);
  });

  it("sets free when the account is neither admin nor on an active subscription", () => {
    expect(tierAfterLifetimeRevoke({ is_admin: false, tier: "pro" }, [], PRICES)).toBe("free");
    expect(tierAfterLifetimeRevoke(
      { is_admin: false, tier: "pro" },
      [{ status: "past_due", priceId: "price_pro" }],
      PRICES,
    )).toBe("free");
  });
});

describe("subscription tier guard", () => {
  it("maps an active or trialing pro, yearly, or basic price to pro", () => {
    expect(tierFromSubscription("active", "price_pro", PRICES)).toBe("pro");
    expect(tierFromSubscription("trialing", "price_year", PRICES)).toBe("pro");
    expect(tierFromSubscription("active", "price_basic", PRICES)).toBe("pro");
  });

  it("treats subscription.deleted as free regardless of the price still on the item", () => {
    expect(tierForSubscriptionEvent("customer.subscription.deleted", "active", "price_pro", PRICES)).toBe("free");
    expect(tierForSubscriptionEvent("customer.subscription.updated", "active", "price_pro", PRICES)).toBe("pro");
  });

  it("maps every other subscription state to free", () => {
    for (const status of ["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]) {
      expect(tierFromSubscription(status, "price_pro", PRICES), status).toBe("free");
    }
    expect(tierFromSubscription("active", "price_other", PRICES)).toBe("free");
  });

  it("never lets a subscription event downgrade lifetime or admin", () => {
    expect(subscriptionTierChangeAllowed({ lifetime: true, is_admin: false }, "free")).toBe(false);
    expect(subscriptionTierChangeAllowed({ lifetime: false, is_admin: true }, "free")).toBe(false);
    expect(subscriptionTierChangeAllowed({ lifetime: true, is_admin: true }, "free")).toBe(false);
  });

  it("still allows a pro write and a downgrade of an ordinary subscriber", () => {
    expect(subscriptionTierChangeAllowed({ lifetime: true, is_admin: false }, "pro")).toBe(true);
    expect(subscriptionTierChangeAllowed({ lifetime: false, is_admin: true }, "pro")).toBe(true);
    expect(subscriptionTierChangeAllowed({ lifetime: false, is_admin: false }, "free")).toBe(true);
    expect(subscriptionTierChangeAllowed(undefined, "free")).toBe(true);
  });
});
