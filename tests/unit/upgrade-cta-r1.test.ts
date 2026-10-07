import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const chrome = read("../../src/preview/PreviewChrome.tsx");
const css = read("../../src/preview/preview.css");

describe("remaining upgrade controls", () => {
  it("tracks the landing Compare plans tile and leaves the label", () => {
    expect(landing).toContain('to="/pricing" onClick={() => trackUpgradeCta("landing_plan_tile")}>Compare plans</Link>');
  });

  it("gives the upgrade controls a 44px target under 600px and leaves desktop sizes", () => {
    const phone = css.slice(css.indexOf("Phone tap targets for the remaining upgrade controls"));
    expect(phone).toMatch(/@media \(max-width: 599px\)/);
    expect(phone).toContain(".preview-tile--plan .preview-btn--block");
    expect(phone).toContain('.preview-nav__links a[href="/pricing"]');
    expect(phone).toContain('.preview-footer__grid a[href="/pricing"]');
    expect(phone).toContain(".preview-page__meta a.preview-btn");
    expect(phone).toMatch(/min-height:\s*44px/);
    expect(phone).toMatch(/min-width:\s*44px/);
    expect(css).toMatch(/\.preview-btn--quiet\s*\{[^}]*min-height:\s*24px/);
    expect(css).toMatch(/\.preview-btn--block\s*\{[^}]*min-height:\s*34px/);
  });

  it("tracks nav and footer Pricing with the same id and keeps them as router links", () => {
    expect(chrome).toContain('trackUpgradeCta("nav_pricing")');
    expect(chrome).toContain('onClick={item.to === "/pricing" ? trackNavPricing : undefined}');
    expect(chrome).toContain('<Link to="/pricing" onClick={trackNavPricing}>Pricing</Link>');
    expect(chrome).not.toContain('href="/pricing"');
  });
});
