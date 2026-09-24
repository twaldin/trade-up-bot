import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authUserFrom, shareActionPanel } from "../../src/preview/lib/auth-state.js";

const dir = dirname(fileURLToPath(import.meta.url));
const share = readFileSync(resolve(dir, "../../src/preview/pages/PreviewShare.tsx"), "utf8");

describe("share page auth tri-state", () => {
  it("treats /api/auth/me payloads without a steam_id as logged out", () => {
    expect(authUserFrom(null)).toBeNull();
    expect(authUserFrom({})).toBeNull();
    expect(authUserFrom({ steam_id: "" })).toBeNull();
    expect(authUserFrom({ steam_id: "765", tier: "free" })).toEqual({ steam_id: "765", tier: "free" });
  });

  it("shows no action panel while the session is still loading", () => {
    expect(shareActionPanel(undefined)).toBe("pending");
  });

  it("shows the sign-in panel only once the session resolved as logged out", () => {
    expect(shareActionPanel(null)).toBe("sign-in");
  });

  it("shows Verify/Claim controls for Pro and admin accounts", () => {
    expect(shareActionPanel({ steam_id: "1", tier: "pro" })).toBe("pro");
    expect(shareActionPanel({ steam_id: "1", tier: "admin" })).toBe("pro");
    expect(shareActionPanel({ steam_id: "1", tier: "free", is_admin: true })).toBe("pro");
  });

  it("shows a Pro-only upgrade prompt to a logged-in Free account", () => {
    expect(shareActionPanel({ steam_id: "1", tier: "free" })).toBe("upgrade");
    expect(share).toContain('panel === "upgrade"');
    expect(share).toContain("Verify and Claim are Pro-only.");
    expect(share).toContain('surface: "share_verify"');
  });

  it("starts the share page user as undefined, not null", () => {
    expect(share).toContain("useState<AuthUser | null | undefined>(undefined)");
    expect(share).not.toContain("useState<AuthUser | null>(null)");
    expect(share).toContain("shareActionPanel(user)");
  });
});
