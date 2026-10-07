import type { StripePool } from "../../server/stripe-entitlement.js";

/**
 * In-memory stand-in for the webhook's event-id bookkeeping.
 * User lookups still fail, which is what the conversion-tracking tests expect
 * when no Steam account can be resolved.
 */
export function trackingWebhookPool(): StripePool {
  const seen = new Set<string>();
  const query: StripePool["query"] = async <T>(sql: string, values?: unknown[]) => {
    const text = sql.replace(/\s+/g, " ").trim();
    const empty: { rows: T[]; rowCount: number } = { rows: [], rowCount: 0 };
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return empty;
    if (text.startsWith("CREATE TABLE IF NOT EXISTS")) return empty;
    if (text.startsWith("INSERT INTO stripe_webhook_events")) {
      const id = String(values?.[0]);
      if (seen.has(id)) return empty;
      seen.add(id);
      return { rows: [], rowCount: 1 };
    }
    throw new Error("connect ECONNREFUSED 127.0.0.1:1");
  };
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}
