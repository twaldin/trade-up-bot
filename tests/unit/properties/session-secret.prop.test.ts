import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEV_SESSION_SECRET,
  MIN_PRODUCTION_SESSION_SECRET_LENGTH,
  productionSessionSecretRefusal,
  resolveSessionSecrets,
} from "../../../server/session-secret.js";

const REFUSALS = [
  "Refusing to start: SESSION_SECRET is missing in production.",
  "Refusing to start: SESSION_SECRET is the dev default in production.",
  "Refusing to start: SESSION_SECRET is shorter than 32 characters in production.",
];
const STATIC_REFUSAL = new RegExp(`^(${REFUSALS.map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

describe("session secret properties", () => {
  it("refuses every production secret that is empty, the dev default, or under 32 characters", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (secret) => {
        const trimmed = secret.trim();
        const refusal = productionSessionSecretRefusal(secret);
        if (trimmed.length >= MIN_PRODUCTION_SESSION_SECRET_LENGTH && trimmed !== DEV_SESSION_SECRET) {
          expect(refusal).toBeNull();
          expect(resolveSessionSecrets({ NODE_ENV: "production", SESSION_SECRET: secret })).toBe(trimmed);
          return;
        }
        expect(refusal).toMatch(STATIC_REFUSAL);
        expect(refusal).not.toContain(DEV_SESSION_SECRET);
        if (trimmed.length >= 8 && REFUSALS.every((line) => !line.includes(trimmed))) {
          expect(refusal).not.toContain(trimmed);
        }
        expect(() => resolveSessionSecrets({ NODE_ENV: "production", SESSION_SECRET: secret })).toThrow(STATIC_REFUSAL);
      }),
      { numRuns: 200 },
    );
  });
});
