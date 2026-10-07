/**
 * Real-browser harness for the board claim control. Served by
 * tests/unit/board-claim-viewport.test.ts.
 * `?mode=collapsed|modal|pro|500|retry`.
 * Pro, 500, and retry are signed-in Pro. The first claim tap only asks
 * "Claim for 30 min?"; the POST happens on Confirm. `500` fails that POST.
 * `retry` fails the first Confirm and succeeds the next one.
 */
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { makeTradeUp } from "./fixtures.js";

declare global {
  interface Window {
    __claims: number;
    __gtag: unknown[][];
  }
}

const mode = new URLSearchParams(window.location.search).get("mode") ?? "modal";
const pro = mode === "pro" || mode === "500" || mode === "retry";
let claimAttempts = 0;

window.__claims = 0;
window.__gtag = [];
window.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
window.gtag = ((command: string, eventName: string, params?: Record<string, string>) => {
  window.__gtag.push([command, eventName, params]);
}) as typeof window.gtag;

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/claim") && init?.method === "POST") {
    window.__claims += 1;
    claimAttempts += 1;
    const fail = mode === "500" || (mode === "retry" && claimAttempts === 1);
    if (fail) {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ claim: { expires_at: "2099-01-01T00:00:00.000Z" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("{}", { status: 404 });
}) as typeof window.fetch;

const root = document.getElementById("root");
if (!root) throw new Error("missing root");

createRoot(root).render(
  <MemoryRouter>
    <div data-preview="true" data-system="outlay" data-mode="dark">
      <PreviewBoard
        tradeUps={[makeTradeUp({ id: 42 })]}
        loading={false}
        isFree={!pro}
        signedIn={pro}
        tier={pro ? "pro" : "free"}
        expandedId={mode === "collapsed" ? null : 42}
        onExpand={() => {}}
      />
    </div>
  </MemoryRouter>,
);
