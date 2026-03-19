// Discord alert system: detects new all-time top trade-ups and posts to webhooks.
// State is kept in Redis for fast comparison — no DB queries at alert time.

import type pg from "pg";
import type Redis from "ioredis";

const METRICS = ["profit_cents", "roi_percentage", "chance_to_profit"] as const;
type Metric = typeof METRICS[number];

const METRIC_LABELS: Record<Metric, string> = {
  profit_cents: "Profit",
  roi_percentage: "ROI",
  chance_to_profit: "Chance to Profit",
};

const METRIC_ALERT_TYPE: Record<Metric, "profit" | "roi" | "chance"> = {
  profit_cents: "profit",
  roi_percentage: "roi",
  chance_to_profit: "chance",
};

const TYPES = [
  "covert_knife",
  "classified_covert",
  "restricted_classified",
  "milspec_restricted",
  "industrial_milspec",
  "consumer_industrial",
];

const TYPE_WEBHOOK_KEY: Record<string, string> = {
  covert_knife: "DISCORD_WEBHOOK_KNIFE",
  classified_covert: "DISCORD_WEBHOOK_COVERT",
  restricted_classified: "DISCORD_WEBHOOK_CLASSIFIED",
  milspec_restricted: "DISCORD_WEBHOOK_RESTRICTED",
  industrial_milspec: "DISCORD_WEBHOOK_MILSPEC",
  consumer_industrial: "DISCORD_WEBHOOK_INDUSTRIAL",
};

const TYPE_ALERT_ROLE: Record<string, string> = {
  covert_knife: "knife-alerts",
  classified_covert: "covert-alerts",
  restricted_classified: "classified-alerts",
  milspec_restricted: "restricted-alerts",
  industrial_milspec: "milspec-alerts",
  consumer_industrial: "industrial-alerts",
};

const TYPE_LABELS: Record<string, string> = {
  covert_knife: "Knife/Gloves",
  classified_covert: "Covert",
  restricted_classified: "Classified",
  milspec_restricted: "Restricted",
  industrial_milspec: "Mil-Spec",
  consumer_industrial: "Industrial",
};

const TYPE_COLORS: Record<string, number> = {
  covert_knife: 0xf1c40f,
  classified_covert: 0xe74c3c,
  restricted_classified: 0xe91e8b,
  milspec_restricted: 0x9b59b6,
  industrial_milspec: 0x3498db,
  consumer_industrial: 0x5dade2,
};

interface TopEntry {
  id: number;
  value: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  total_cost_cents: number;
  expected_value_cents: number;
  best_case_cents: number;
  worst_case_cents: number;
}

function redisKey(type: string, metric: Metric): string {
  return `discord:top:${type}:${metric}`;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Initialize alert state: query DB for current tops and seed Redis.
 * Called once on daemon startup.
 */
export async function initAlertState(pool: pg.Pool, redis: Redis): Promise<void> {
  console.log("  Initializing Discord alert state...");
  let seeded = 0;

  for (const type of TYPES) {
    for (const metric of METRICS) {
      try {
        const { rows } = await pool.query(
          `SELECT id, profit_cents, roi_percentage, chance_to_profit,
                  total_cost_cents, expected_value_cents,
                  COALESCE(best_case_cents, 0) as best_case_cents,
                  COALESCE(worst_case_cents, 0) as worst_case_cents
           FROM trade_ups
           WHERE type = $1 AND listing_status = 'active' AND is_theoretical = 0
           ORDER BY ${metric} DESC LIMIT 1`,
          [type],
        );

        if (rows.length > 0) {
          const row = rows[0];
          const entry: TopEntry = {
            id: row.id,
            value: Number(row[metric]),
            profit_cents: Number(row.profit_cents),
            roi_percentage: Number(row.roi_percentage),
            chance_to_profit: Number(row.chance_to_profit),
            total_cost_cents: Number(row.total_cost_cents),
            expected_value_cents: Number(row.expected_value_cents),
            best_case_cents: Number(row.best_case_cents),
            worst_case_cents: Number(row.worst_case_cents),
          };
          await redis.set(redisKey(type, metric), JSON.stringify(entry));
          seeded++;
        }
      } catch (err: any) {
        console.error(`  Alert init failed for ${type}:${metric}: ${err.message}`);
      }
    }
  }

  console.log(`  Alert state seeded: ${seeded} entries across ${TYPES.length} types`);
}

/**
 * Check merged trade-ups against Redis-cached tops. Fire webhook on new records.
 * Called after every mergeTradeUps. Pure Redis + in-memory — no DB queries.
 */
export async function checkAndFireAlerts(
  redis: Redis,
  mergedTradeUps: Array<{
    id: number;
    profit_cents: number;
    roi_percentage: number;
    chance_to_profit?: number;
    total_cost_cents: number;
    expected_value_cents: number;
    best_case_cents?: number;
    worst_case_cents?: number;
  }>,
  tradeUpType: string,
): Promise<void> {
  if (mergedTradeUps.length === 0) return;
  if (!TYPES.includes(tradeUpType)) return;

  for (const metric of METRICS) {
    // Find the best in this batch for this metric
    let bestInBatch: typeof mergedTradeUps[0] | null = null;
    let bestValue = -Infinity;

    for (const tu of mergedTradeUps) {
      const val = metric === "profit_cents" ? tu.profit_cents
        : metric === "roi_percentage" ? tu.roi_percentage
        : (tu.chance_to_profit ?? 0);

      if (val > bestValue) {
        bestValue = val;
        bestInBatch = tu;
      }
    }

    if (!bestInBatch || bestValue <= 0) continue;

    // Compare with cached top
    const key = redisKey(tradeUpType, metric);
    const cached = await redis.get(key);
    let currentTop: TopEntry | null = null;

    if (cached) {
      try { currentTop = JSON.parse(cached); } catch { /* corrupt cache, treat as empty */ }
    }

    // New record: must strictly beat the current top
    if (currentTop && bestValue <= currentTop.value) continue;

    // Update Redis with new top
    const newEntry: TopEntry = {
      id: bestInBatch.id,
      value: bestValue,
      profit_cents: bestInBatch.profit_cents,
      roi_percentage: bestInBatch.roi_percentage,
      chance_to_profit: bestInBatch.chance_to_profit ?? 0,
      total_cost_cents: bestInBatch.total_cost_cents,
      expected_value_cents: bestInBatch.expected_value_cents,
      best_case_cents: bestInBatch.best_case_cents ?? 0,
      worst_case_cents: bestInBatch.worst_case_cents ?? 0,
    };
    await redis.set(key, JSON.stringify(newEntry));

    // Fire webhook
    const webhookEnvKey = TYPE_WEBHOOK_KEY[tradeUpType];
    const webhookUrl = webhookEnvKey ? process.env[webhookEnvKey] : undefined;
    if (!webhookUrl) continue;

    const tierLabel = TYPE_LABELS[tradeUpType] || tradeUpType;
    const metricLabel = METRIC_LABELS[metric];

    // Get ping role ID from Redis
    const alertRoleName = TYPE_ALERT_ROLE[tradeUpType];
    const roleId = alertRoleName ? await redis.get(`discord:role:${alertRoleName}`).catch(() => null) : null;

    const embed = {
      color: TYPE_COLORS[tradeUpType] ?? 0x2ecc71,
      title: `New #1 ${metricLabel} — ${tierLabel}`,
      fields: [
        { name: "Profit", value: formatDollars(newEntry.profit_cents), inline: true },
        { name: "ROI", value: `${newEntry.roi_percentage.toFixed(1)}%`, inline: true },
        { name: "Chance", value: `${(newEntry.chance_to_profit * 100).toFixed(1)}%`, inline: true },
        { name: "Cost", value: formatDollars(newEntry.total_cost_cents), inline: true },
        { name: "EV", value: formatDollars(newEntry.expected_value_cents), inline: true },
        { name: "Range", value: `${formatDollars(newEntry.worst_case_cents)} — ${formatDollars(newEntry.best_case_cents)}`, inline: true },
      ],
      footer: { text: `ID: ${newEntry.id}` },
      timestamp: new Date().toISOString(),
      url: `https://tradeupbot.app/dashboard?type=${tradeUpType}`,
    };

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: roleId ? `<@&${roleId}> New all-time top ${metricLabel.toLowerCase()}!` : undefined,
          embeds: [embed],
        }),
      });
      console.log(`    Alert fired: ${tierLabel} new #1 ${metricLabel} (${formatDollars(newEntry.profit_cents)} profit)`);
    } catch (err: any) {
      console.error(`    Alert webhook failed: ${err.message}`);
    }
  }
}

/**
 * Re-validate cached tops during housekeeping.
 * If a cached top's trade-up is no longer active, re-query DB for the new top.
 */
export async function refreshAlertTops(pool: pg.Pool, redis: Redis): Promise<void> {
  for (const type of TYPES) {
    for (const metric of METRICS) {
      const key = redisKey(type, metric);
      const cached = await redis.get(key).catch(() => null);
      if (!cached) continue;

      let entry: TopEntry;
      try { entry = JSON.parse(cached); } catch { continue; }

      // Check if the cached top is still active
      const { rows } = await pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1",
        [entry.id],
      );

      if (rows.length > 0 && rows[0].listing_status === "active") continue;

      // Cached top is no longer active — find new top
      const { rows: newRows } = await pool.query(
        `SELECT id, profit_cents, roi_percentage, chance_to_profit,
                total_cost_cents, expected_value_cents,
                COALESCE(best_case_cents, 0) as best_case_cents,
                COALESCE(worst_case_cents, 0) as worst_case_cents
         FROM trade_ups
         WHERE type = $1 AND listing_status = 'active' AND is_theoretical = 0
         ORDER BY ${metric} DESC LIMIT 1`,
        [type],
      );

      if (newRows.length > 0) {
        const row = newRows[0];
        const newEntry: TopEntry = {
          id: row.id,
          value: Number(row[metric]),
          profit_cents: Number(row.profit_cents),
          roi_percentage: Number(row.roi_percentage),
          chance_to_profit: Number(row.chance_to_profit),
          total_cost_cents: Number(row.total_cost_cents),
          expected_value_cents: Number(row.expected_value_cents),
          best_case_cents: Number(row.best_case_cents),
          worst_case_cents: Number(row.worst_case_cents),
        };
        await redis.set(key, JSON.stringify(newEntry));
      } else {
        await redis.del(key);
      }
    }
  }
}
