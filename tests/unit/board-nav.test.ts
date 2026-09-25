/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewShell } from "../../src/preview/PreviewShell.js";

function SearchEcho() {
  const { search } = useLocation();
  return createElement("output", null, search);
}

describe("sidebar Board link", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => { root?.unmount(); });
    host?.remove();
  });

  it("clicking Board while on /trade-ups?x=y keeps ?x=y", async () => {
    window.history.replaceState(null, "", "/trade-ups?x=y");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups?x=y"] },
        createElement(Routes, null,
          createElement(Route, {
            path: "/trade-ups",
            element: createElement(PreviewShell, { mode: "dark", onMode: () => {}, children: createElement(SearchEcho) }),
          }),
          createElement(Route, { path: "/skins", element: createElement(SearchEcho) }),
        ),
      ));
    });
    const link = [...host.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Board");
    await act(async () => { link?.click(); });
    expect(host.querySelector("output")?.textContent).toBe("?x=y");
    const skins = [...host.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Skins");
    await act(async () => { skins?.click(); });
    expect(host.querySelector("output")?.textContent).toBe("");
  });

  it("leaves Cmd-click and other modified clicks alone", async () => {
    window.history.replaceState(null, "", "/trade-ups?x=y");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups?x=y"] },
        createElement(Routes, null,
          createElement(Route, {
            path: "/trade-ups",
            element: createElement(PreviewShell, { mode: "dark", onMode: () => {}, children: createElement(SearchEcho) }),
          }),
        ),
      ));
    });
    const link = [...host.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Board");
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      link?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(host.querySelector("output")?.textContent).toBe("?x=y");
  });
});
