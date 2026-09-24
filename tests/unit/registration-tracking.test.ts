import { describe, it, expect, vi } from "vitest";
import { registrationEventId } from "../../shared/tracking.js";
import { hashExternalId } from "../../server/tracking.js";
import { authReturnLocation, metaRegistrationRequest, trackCompleteRegistration } from "../../server/tracking/registration.js";

const HASH = hashExternalId("76561198000000000");
const ENV_OFF = {};
const ENV_ON = { GA4_MEASUREMENT_ID: "G-NEWPROP123", META_PIXEL_ID: "123456789012345", META_CAPI_TOKEN: "meta-token-value" };

describe("authReturnLocation", () => {
  it("leaves the return path unchanged when tracking is unset", () => {
    expect(authReturnLocation("/trade-ups", true, HASH, ENV_OFF)).toBe("/trade-ups");
  });

  it("marks a new account and a return visit when a browser tracker is configured", () => {
    expect(authReturnLocation("/trade-ups?ref=a", true, HASH, ENV_ON)).toBe(`/trade-ups?ref=a&auth=new&eid=${registrationEventId(HASH!)}`);
    expect(authReturnLocation("/", false, HASH, ENV_ON)).toBe("/?auth=return");
  });

  it("rejects an off-site return path", () => {
    expect(authReturnLocation("https://evil.example/", true, HASH, ENV_ON)).toBe("https://evil.example/");
  });
});

describe("CompleteRegistration CAPI", () => {
  it("uses the same event id as the browser and hashes the Steam ID", () => {
    const req = metaRegistrationRequest({
      externalIdHash: HASH!,
      eventTimeSec: 1_700_000_100,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 test",
      fbp: "fb.1.1.2",
      fbc: null,
      pixelId: "123456789012345",
      accessToken: "meta-token-value",
      baseUrl: "https://tradeupbot.app",
    });
    expect(req.body.data[0].event_id).toBe(registrationEventId(HASH!));
    expect(req.body.data[0].event_name).toBe("CompleteRegistration");
    expect(req.body.data[0].user_data.external_id).toEqual([HASH]);
    expect(JSON.stringify(req.body)).not.toContain("76561198000000000");
  });

  it("does not call the network when CAPI is unset, and never throws when fetch rejects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("down"); });
    await expect(trackCompleteRegistration({ steamId: "76561198000000000", ip: null, userAgent: null, cookieHeader: undefined, env: ENV_OFF, fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(trackCompleteRegistration({ steamId: "76561198000000000", ip: "203.0.113.7", userAgent: "Mozilla", cookieHeader: "_fbp=fb.1.1.2", env: ENV_ON, fetchImpl, log: () => {} })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
