// Board concentration for engine-monitor. Read-only and separate from the
// existing board aggregate so a timeout cannot blank M1/M2 or change the exit code.
//
// Active rows use the monitor's existing predicate. Profitable rows are that
// same predicate plus profit_cents > 0 (the daemon's profitable count).
// Partial rows are non-theoretical trade-ups with listing_status = 'partial'.
// Their ge10/ge30 counts use trade_up_score, the same column as the board aggregate.

import { parseDaemonCadence } from "./daemon-cadence.mjs";

export const ACTIVE_TRADE_UP_PREDICATE = "is_theoretical = false AND listing_status = 'active'";
export const PROFITABLE_TRADE_UP_PREDICATE = `${ACTIVE_TRADE_UP_PREDICATE} AND profit_cents > 0`;
export const PARTIAL_TRADE_UP_PREDICATE = "is_theoretical = false AND listing_status = 'partial'";

export const BOARD_PSQL_TIMEOUT_MS = 30_000;
export const CONCENTRATION_STATEMENT_TIMEOUT = "5s";
export const CONCENTRATION_STATEMENT_TIMEOUT_MS = 5_000;
export const CONCENTRATION_LOCK_TIMEOUT = "2s";
export const CONCENTRATION_EXEC_TIMEOUT_MS = 8_000;
export const PROFITABLE_GROUP_LIMIT = 10;

export const BOARD_OUTPUT_KEYS = [
  "m1MedianTop100",
  "m2CountGe50",
  "countGe30",
  "countGe10",
  "nullScores",
  "maxScore",
  "activeRows",
  "staircaseActive",
  "e2Provenance",
];

export const MONITOR_SUCCESS_SUMMARY = "Read PM2 health, production git head, board metrics, E2 provenance, daemon cadence, and error metadata.";

function boundedReadOnly(statementSql) {
  return [
    "BEGIN READ ONLY;",
    `SET LOCAL statement_timeout = '${CONCENTRATION_STATEMENT_TIMEOUT}';`,
    `SET LOCAL lock_timeout = '${CONCENTRATION_LOCK_TIMEOUT}';`,
    statementSql.trim(),
    "COMMIT;",
    "",
  ].join("\n");
}

// Group identity is the sorted set of input collections. trade_ups.collection_names
// is that set (writers store distinct input collection names). Normalize again so a
// stale write order cannot split one family into two. This stays on trade_ups:
// idx_tu_active_profit satisfies the profitable predicate, and the aggregate never
// touches trade_up_inputs.
export const GROUPS_SQL = boundedReadOnly(`
WITH profitable AS MATERIALIZED (
  SELECT
    trade_up_score,
    ARRAY(
      SELECT DISTINCT collection_name
      FROM unnest(collection_names) AS names(collection_name)
      WHERE collection_name IS NOT NULL
      ORDER BY collection_name
    ) AS collections
  FROM trade_ups
  WHERE ${PROFITABLE_TRADE_UP_PREDICATE}
),
grouped AS (
  SELECT collections, count(*)::int AS group_count, max(trade_up_score) AS max_score
  FROM profitable
  GROUP BY collections
)
SELECT json_build_object(
  'profitableGroupCount', (SELECT count(*)::int FROM grouped),
  'profitableByCollectionGroup', COALESCE((
    SELECT json_agg(
      json_build_object(
        'collections', top_groups.collections,
        'count', top_groups.group_count,
        'maxScore', top_groups.max_score
      )
      ORDER BY top_groups.group_count DESC, top_groups.collections
    )
    FROM (
      SELECT collections, group_count, max_score
      FROM grouped
      ORDER BY group_count DESC, collections
      LIMIT ${PROFITABLE_GROUP_LIMIT}
    ) AS top_groups
  ), '[]'::json)
)::text;
`);

// Distinct listing ids for those same rows. MATERIALIZED keeps the profitable id
// set small (~tens of thousands). LATERAL plus idx_trade_up_inputs_trade probes
// that index per id instead of scanning trade_up_inputs.
export const LISTINGS_SQL = boundedReadOnly(`
WITH profitable AS MATERIALIZED (
  SELECT id
  FROM trade_ups
  WHERE ${PROFITABLE_TRADE_UP_PREDICATE}
)
SELECT json_build_object(
  'distinctProfitableInputListings', count(DISTINCT inputs.listing_id)::int
)::text
FROM profitable
CROSS JOIN LATERAL (
  SELECT listing_id
  FROM trade_up_inputs
  WHERE trade_up_id = profitable.id
) AS inputs;
`);

// Same read-only budget as the concentration scripts. idx_trade_ups_listing_status
// can filter listing_status; this script does not create an index. A timeout or
// error nulls the counts and records partialError. It does not fail the monitor.
export const PARTIAL_SQL = boundedReadOnly(`
SELECT json_build_object(
  'partialGe10', (count(*) FILTER (WHERE trade_up_score >= 10))::int,
  'partialGe30', (count(*) FILTER (WHERE trade_up_score >= 30))::int
)::text
FROM trade_ups
WHERE ${PARTIAL_TRADE_UP_PREDICATE};
`);

export function runOptionalQuery(execFileSyncImpl, databaseUrl, sql, timeoutMs, failureLabel = "concentration query failed") {
  function redactMonitorText(text) {
    return String(text)
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
      .replace(/password\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;,&]*)/gi, "password=[redacted]");
  }

  function describe(error) {
    const stderr = error && error.stderr != null ? String(error.stderr) : "";
    const code = error && error.code != null ? String(error.code) : "";
    // Postgres names the cause in stderr. Node's execFileSync timeout sets
    // code ETIMEDOUT after it kills psql, which is a different failure.
    if (/statement timeout/i.test(stderr)) return "statement timeout";
    if (/lock timeout/i.test(stderr)) return "lock timeout";
    if (code === "ETIMEDOUT") return "exec timeout";
    const lines = redactMonitorText(stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const errorLine = lines.find((line) => line.startsWith("ERROR:")) ?? lines[0];
    if (!errorLine) return failureLabel;
    return errorLine.slice(0, 240);
  }

  try {
    const stdout = execFileSyncImpl("psql", [
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-At",
      "-c",
      sql,
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, text: String(stdout).trim() };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

function asQueryResult(value, label = "concentration query") {
  if (!value || typeof value !== "object") {
    return { ok: false, message: `${label} did not run` };
  }
  if (value.ok === true) {
    return { ok: true, text: typeof value.text === "string" ? value.text : "" };
  }
  if (value.ok === false) {
    const message = typeof value.message === "string" && value.message
      ? value.message
      : `${label} failed`;
    return { ok: false, message };
  }
  return { ok: false, message: `${label} did not run` };
}

function isGroupRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const keys = Object.keys(row);
  if (keys.length !== 3 || !keys.includes("collections") || !keys.includes("count") || !keys.includes("maxScore")) {
    return false;
  }
  if (!Array.isArray(row.collections) || !row.collections.every((name) => typeof name === "string")) return false;
  if (!Number.isInteger(row.count) || row.count < 0) return false;
  if (!(row.maxScore === null || Number.isInteger(row.maxScore))) return false;
  return true;
}

function interpretGroups(query) {
  const result = asQueryResult(query);
  if (!result.ok) return { ok: false, message: result.message };
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { ok: false, message: "unexpected concentration payload" };
  }
  const rows = parsed?.profitableByCollectionGroup;
  const count = parsed?.profitableGroupCount;
  if (!Number.isInteger(count) || count < 0 || !Array.isArray(rows) || rows.length > PROFITABLE_GROUP_LIMIT || rows.length > count) {
    return { ok: false, message: "unexpected concentration payload" };
  }
  if (!rows.every(isGroupRow)) return { ok: false, message: "unexpected concentration payload" };
  return { ok: true, rows, count };
}

function interpretListings(query) {
  const result = asQueryResult(query);
  if (!result.ok) return { ok: false, message: result.message };
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { ok: false, message: "unexpected concentration payload" };
  }
  const value = parsed?.distinctProfitableInputListings;
  if (!Number.isInteger(value) || value < 0) return { ok: false, message: "unexpected concentration payload" };
  return { ok: true, value };
}

function combineReasons(groups, listings) {
  const groupsReason = groups.ok ? null : groups.message;
  const listingsReason = listings.ok ? null : listings.message;
  if (!groupsReason && !listingsReason) return null;
  if (groupsReason && listingsReason) {
    if (groupsReason === listingsReason) return groupsReason;
    return `profitableByCollectionGroup: ${groupsReason}; distinctProfitableInputListings: ${listingsReason}`;
  }
  if (groupsReason) return `profitableByCollectionGroup: ${groupsReason}`;
  return `distinctProfitableInputListings: ${listingsReason}`;
}

export function shapePartial(board, query) {
  const next = { ...board };
  const result = asQueryResult(query, "partial query");
  if (!result.ok) {
    next.partialGe10 = null;
    next.partialGe30 = null;
    next.partialError = result.message;
    return next;
  }
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = null;
  }
  const ge10 = parsed?.partialGe10;
  const ge30 = parsed?.partialGe30;
  if (!Number.isInteger(ge10) || ge10 < 0 || !Number.isInteger(ge30) || ge30 < 0 || ge30 > ge10) {
    next.partialGe10 = null;
    next.partialGe30 = null;
    next.partialError = "unexpected partial payload";
    return next;
  }
  next.partialGe10 = ge10;
  next.partialGe30 = ge30;
  next.partialError = null;
  return next;
}

export function shapeConcentration(board, queries) {
  const next = { ...board };
  const groups = interpretGroups(queries?.groups);
  const listings = interpretListings(queries?.listings);
  next.distinctProfitableInputListings = listings.ok ? listings.value : null;
  next.profitableByCollectionGroup = groups.ok ? groups.rows : null;
  next.profitableGroupCount = groups.ok ? groups.count : null;
  next.concentrationError = combineReasons(groups, listings);
  return next;
}

export function applyRemoteObservation(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const hasQueries = Object.hasOwn(details, "concentrationQueries");
  const hasPartial = Object.hasOwn(details, "partialQuery");
  if (!details.board || typeof details.board !== "object" || Array.isArray(details.board)) {
    if (!hasQueries && !hasPartial) return details;
    const stripped = { ...details };
    delete stripped.concentrationQueries;
    delete stripped.partialQuery;
    return stripped;
  }
  const shaped = shapeConcentration(details.board, details.concentrationQueries);
  const next = {
    ...details,
    board: hasPartial ? shapePartial(shaped, details.partialQuery) : shaped,
  };
  delete next.concentrationQueries;
  delete next.partialQuery;
  return next;
}

function groupLabel(row) {
  if (!row || !Array.isArray(row.collections) || !Number.isInteger(row.count)) return null;
  const name = row.collections.length > 0 ? row.collections.join(" + ") : "(none)";
  return `${name} ${row.count}`;
}

function topGroupClause(board) {
  const top = Array.isArray(board.profitableByCollectionGroup)
    ? board.profitableByCollectionGroup.slice(0, 3).map(groupLabel).filter(Boolean).join(", ")
    : "";
  return top ? ` (${top})` : "";
}

function partialSentence(board) {
  if (!board || typeof board !== "object" || Array.isArray(board) || !Object.hasOwn(board, "partialGe10")) return "";
  const ge10 = board.partialGe10;
  const ge30 = board.partialGe30;
  if (Number.isInteger(ge10) && ge10 >= 0 && Number.isInteger(ge30) && ge30 >= 0) {
    return ` Partial: ${ge10} ge10, ${ge30} ge30.`;
  }
  const error = typeof board.partialError === "string" && board.partialError ? board.partialError : "unknown error";
  return ` Partial ge10/ge30 unavailable (${error}).`;
}

export function describeConcentration(board) {
  const partial = partialSentence(board);
  if (!board || typeof board !== "object" || !Object.hasOwn(board, "distinctProfitableInputListings")) {
    return MONITOR_SUCCESS_SUMMARY + partial;
  }
  const listings = board.distinctProfitableInputListings;
  const groups = board.profitableGroupCount;
  const error = typeof board.concentrationError === "string" && board.concentrationError
    ? board.concentrationError
    : "unknown error";
  if (listings == null && groups == null) {
    return `${MONITOR_SUCCESS_SUMMARY} Concentration unavailable (${error}).${partial}`;
  }
  if (listings != null && groups != null) {
    return `${MONITOR_SUCCESS_SUMMARY} Concentration: ${listings} distinct profitable input listings across ${groups} collection groups${topGroupClause(board)}.${partial}`;
  }
  if (listings == null) {
    return `${MONITOR_SUCCESS_SUMMARY} Concentration: ${groups} collection groups${topGroupClause(board)}; distinct profitable input listings unavailable (${error}).${partial}`;
  }
  return `${MONITOR_SUCCESS_SUMMARY} Concentration: ${listings} distinct profitable input listings; collection groups unavailable (${error}).${partial}`;
}

export function assembleRemoteProgram(template, boardSql) {
  return template
    .replaceAll("__AUTORESEARCH_BOARD_SQL__", () => JSON.stringify(boardSql))
    .replaceAll("__AUTORESEARCH_GROUPS_SQL__", () => JSON.stringify(GROUPS_SQL))
    .replaceAll("__AUTORESEARCH_LISTINGS_SQL__", () => JSON.stringify(LISTINGS_SQL))
    .replaceAll("__AUTORESEARCH_PARTIAL_SQL__", () => JSON.stringify(PARTIAL_SQL))
    .replaceAll("__AUTORESEARCH_RUN_OPTIONAL_QUERY__", () => runOptionalQuery.toString())
    .replaceAll("__AUTORESEARCH_PARSE_DAEMON_CADENCE__", () => parseDaemonCadence.toString())
    .replaceAll("__AUTORESEARCH_CONCENTRATION_TIMEOUT_MS__", () => String(CONCENTRATION_EXEC_TIMEOUT_MS));
}
