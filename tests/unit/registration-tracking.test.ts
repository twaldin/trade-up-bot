import { describe, it, expect, vi } from "vitest";
import { isLoginNonce, loginEventId, registrationEventId } from "../../shared/tracking.js";
import { hashExternalId } from "../../server/tracking.js";
import { loginEventIdFromSteamId, registrationEventIdFromSteamId } from "../../src/lib/registration-id.js";
import { authReturnLocation, LOGIN_NONCE_TTL_MS, metaLoginRequest, metaRegistrationRequest, newLoginNonce, takeIssuedLoginNonce, trackCompleteRegistration, trackLogin } from "../../server/tracking/registration.js";

const HASH = hashExternalId("76561198000000000");
const NONCE = "ab".repeat(16);
const ENV_OFF = {};
const ENV_ON = { GA4_MEASUREMENT_ID: "G-NEWPROP123", META_PIXEL_ID: "123456789012345", META_CAPI_TOKEN: "meta-token-value" };

describe("authReturnLocation", () => {
  it("leaves the return path unchanged when tracking is unset", () => {
    expect(authReturnLocation("/trade-ups", true, ENV_OFF)).toBe("/trade-ups");
  });

  it("marks a new account and a return visit without putting the hash in the URL", () => {
    const created = authReturnLocation("/trade-ups?ref=a", true, ENV_ON);
    expect(created).toBe("/trade-ups?ref=a&auth=new");
    expect(created).not.toContain("eid");
    expect(created).not.toContain(HASH);
    expect(authReturnLocation("/", false, ENV_ON)).toBe("/?auth=return");
    const back = authReturnLocation("/trade-ups", false, ENV_ON, NONCE);
    expect(back).toBe(`/trade-ups?auth=return&lid=${NONCE}`);
    expect(back).not.toContain(HASH);
    expect(authReturnLocation("/trade-ups", false, ENV_OFF, NONCE)).toBe("/trade-ups");
    expect(authReturnLocation("/trade-ups", false, { GA4_MEASUREMENT_ID: "G-NEWPROP123" }, NONCE)).toBe("/trade-ups?auth=return");
    expect(authReturnLocation("/pricing", false, { META_PIXEL_ID: "123456789012345" }, NONCE)).toBe(`/pricing?auth=return&lid=${NONCE}`);
  });

  it("rejects an off-site return path", () => {
    expect(authReturnLocation("https://evil.example/", true, ENV_ON)).toBe("https://evil.example/");
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

describe("issued login nonce", () => {
  const issuedAt = 1_700_000_000_000;
  const stored = { nonce: NONCE, issuedAt };

  it("accepts the issued lid once and rejects a reuse", () => {
    const first = takeIssuedLoginNonce(stored, NONCE, issuedAt);
    expect(first).toEqual({ accepted: true, next: null });
    expect(takeIssuedLoginNonce(first.next, NONCE, issuedAt)).toEqual({ accepted: false, next: null });
    expect(takeIssuedLoginNonce(stored, "cd".repeat(16), issuedAt)).toEqual({ accepted: false, next: stored });
    expect(takeIssuedLoginNonce(stored, "nope", issuedAt)).toEqual({ accepted: false, next: stored });
  });

  it("rejects a nonce once it is 10 minutes old", () => {
    expect(takeIssuedLoginNonce(stored, NONCE, issuedAt + LOGIN_NONCE_TTL_MS - 1).accepted).toBe(true);
    expect(takeIssuedLoginNonce(stored, NONCE, issuedAt + LOGIN_NONCE_TTL_MS)).toEqual({ accepted: false, next: null });
  });
});

describe("Login CAPI", () => {
  it("uses the same event id as the browser and omits email, name, and raw Steam ID", () => {
    const req = metaLoginRequest({
      externalIdHash: HASH!,
      eventTimeSec: 1_700_000_100,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 test",
      fbp: null,
      fbc: "fb.1.1.9",
      pixelId: "123456789012345",
      accessToken: "meta-token-value",
      baseUrl: "https://tradeupbot.app/",
    }, NONCE);
    expect(req.body.data[0].event_name).toBe("Login");
    expect(req.body.data[0].event_id).toBe(loginEventId(HASH!, NONCE));
    expect(req.body.data[0].user_data.external_id).toEqual([HASH]);
    const body = JSON.stringify(req.body);
    expect(body).not.toContain("76561198000000000");
    expect(body.toLowerCase()).not.toContain("email");
    expect(body.toLowerCase()).not.toContain("display_name");
  });

  it("does not call the network when CAPI is unset, and never throws when fetch rejects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("down"); });
    await expect(trackLogin({ steamId: "76561198000000000", nonce: NONCE, ip: null, userAgent: null, cookieHeader: undefined, env: ENV_OFF, fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(trackLogin({ steamId: "76561198000000000", nonce: NONCE, ip: "203.0.113.7", userAgent: "Mozilla", cookieHeader: "_fbp=fb.1.1.2", env: ENV_ON, fetchImpl, log: () => {} })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips Login and CompleteRegistration CAPI for an opted-out external id", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const env = { ...ENV_ON, META_CAPI_OPTOUT_EXTERNAL_IDS: ` ${HASH},not-a-hash` };
    const args = { steamId: "76561198000000000", nonce: NONCE, ip: "203.0.113.7", userAgent: "Mozilla", cookieHeader: undefined, env, fetchImpl };
    await trackLogin(args);
    await trackCompleteRegistration(args);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still sends Login and CompleteRegistration when the opt-out list names a different id", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const env = { ...ENV_ON, META_CAPI_OPTOUT_EXTERNAL_IDS: "ab".repeat(32) };
    const args = { steamId: "76561198000000000", nonce: NONCE, ip: null, userAgent: null, cookieHeader: undefined, env, fetchImpl };
    await trackLogin(args);
    await trackCompleteRegistration(args);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const loginBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { data: Array<{ event_id: string }> };
    expect(loginBody.data[0].event_id).toBe(loginEventId(HASH!, NONCE));
    const names = fetchImpl.mock.calls.map((call) => {
      const body = JSON.parse(String(call[1]?.body)) as { data: Array<{ event_name: string }> };
      return body.data[0].event_name;
    });
    expect(names.sort()).toEqual(["CompleteRegistration", "Login"]);
  });
});

describe("browser registration event id", () => {
  it("matches the server hash of the Steam ID", async () => {
    await expect(registrationEventIdFromSteamId("  76561198000000000 ")).resolves.toBe(registrationEventId(HASH!));
    await expect(loginEventIdFromSteamId("76561198000000000", NONCE)).resolves.toBe(loginEventId(HASH!, NONCE));
    await expect(loginEventIdFromSteamId("76561198000000000", "nope")).resolves.toBeNull();
  });
});

describe("login nonce", () => {
  it("issues a fresh 32-hex nonce for each sign-in", () => {
    const first = newLoginNonce();
    const second = newLoginNonce();
    expect(isLoginNonce(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(loginEventId(HASH!, first)).not.toBe(loginEventId(HASH!, second));
  });
});
