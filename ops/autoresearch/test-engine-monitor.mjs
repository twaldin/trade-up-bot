#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_TRADE_UP_PREDICATE,
  BOARD_OUTPUT_KEYS,
  BOARD_PSQL_TIMEOUT_MS,
  CONCENTRATION_EXEC_TIMEOUT_MS,
  CONCENTRATION_STATEMENT_TIMEOUT_MS,
  GROUPS_SQL,
  LISTINGS_SQL,
  MONITOR_SUCCESS_SUMMARY,
  PROFITABLE_GROUP_LIMIT,
  PROFITABLE_TRADE_UP_PREDICATE,
  applyRemoteObservation,
  describeConcentration,
  runOptionalQuery,
  shapeConcentration,
} from "./lib/board-concentration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const monitorSource = readFileSync(join(here, "bin", "engine-monitor.mjs"), "utf8");

function originalBoard() {
  return {
    m1MedianTop100: 9.5,
    m2CountGe50: 2,
    countGe30: 3,
    countGe10: 4,
    nullScores: 0,
    maxScore: 36,
    activeRows: 790739,
    staircaseActive: 11,
    e2Provenance: { "e2:s1": 4 },
  };
}

function remoteDetails(queries) {
  return {
    observedAt: "2026-10-19T16:00:00.000Z",
    prodHead: "3137ad23e9431768756cc1474ce3067891357d8f",
    processes: [{ name: "daemon", status: "online" }, { name: "api", status: "online" }],
    board: originalBoard(),
    concentrationQueries: queries,
    latestLoopOrCycle: 27,
    daemonOut: { bytes: 10, modifiedAt: "2026-10-19T16:00:00.000Z" },
    daemonError: { bytes: 0, modifiedAt: null },
    breakSignalsInTail: { oom: false, crash: false, database: false },
  };
}

function assertExistingBoardUntouched(before, after) {
  assert.deepEqual(Object.keys(after).slice(0, BOARD_OUTPUT_KEYS.length), BOARD_OUTPUT_KEYS);
  for (const key of BOARD_OUTPUT_KEYS) {
    assert.equal(JSON.stringify(after[key]), JSON.stringify(before[key]), key);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(before)), originalBoard());
}

const groupsPayload = {
  profitableGroupCount: 2,
  profitableByCollectionGroup: [
    { collections: ["Chroma", "Chroma 2", "Dreams & Nightmares"], count: 3, maxScore: 14 },
    { collections: ["Fever"], count: 1, maxScore: 8 },
  ],
};
const listingsPayload = { distinctProfitableInputListings: 4 };

const shaped = shapeConcentration(originalBoard(), {
  groups: { ok: true, text: JSON.stringify(groupsPayload) },
  listings: { ok: true, text: `  ${JSON.stringify(listingsPayload)}  ` },
});
assert.equal(shaped.distinctProfitableInputListings, 4);
assert.equal(shaped.profitableGroupCount, 2);
assert.deepEqual(shaped.profitableByCollectionGroup, groupsPayload.profitableByCollectionGroup);
assert.equal(shaped.concentrationError, null);
assert.deepEqual(Object.keys(shaped), [...BOARD_OUTPUT_KEYS, "distinctProfitableInputListings", "profitableByCollectionGroup", "profitableGroupCount", "concentrationError"]);
assertExistingBoardUntouched(originalBoard(), shaped);
assert.equal(
  describeConcentration(shaped),
  `${MONITOR_SUCCESS_SUMMARY} Concentration: 4 distinct profitable input listings across 2 collection groups (Chroma + Chroma 2 + Dreams & Nightmares 3, Fever 1).`,
);

const zeroBoard = shapeConcentration(originalBoard(), {
  groups: { ok: true, text: JSON.stringify({ profitableGroupCount: 0, profitableByCollectionGroup: [] }) },
  listings: { ok: true, text: JSON.stringify({ distinctProfitableInputListings: 0 }) },
});
assert.equal(zeroBoard.distinctProfitableInputListings, 0);
assert.equal(zeroBoard.profitableGroupCount, 0);
assert.deepEqual(zeroBoard.profitableByCollectionGroup, []);
assert.match(describeConcentration(zeroBoard), /Concentration: 0 distinct profitable input listings across 0 collection groups\./);

const timedOut = shapeConcentration(originalBoard(), {
  groups: { ok: false, message: "statement timeout" },
  listings: { ok: false, message: "statement timeout" },
});
assert.equal(timedOut.distinctProfitableInputListings, null);
assert.equal(timedOut.profitableByCollectionGroup, null);
assert.equal(timedOut.profitableGroupCount, null);
assert.equal(timedOut.concentrationError, "statement timeout");
assertExistingBoardUntouched(originalBoard(), timedOut);
assert.equal(
  describeConcentration(timedOut),
  `${MONITOR_SUCCESS_SUMMARY} Concentration unavailable (statement timeout).`,
);

const listingsTimedOut = shapeConcentration(originalBoard(), {
  groups: { ok: true, text: JSON.stringify(groupsPayload) },
  listings: { ok: false, message: "statement timeout" },
});
assert.equal(listingsTimedOut.distinctProfitableInputListings, null);
assert.equal(listingsTimedOut.profitableGroupCount, 2);
assert.equal(listingsTimedOut.concentrationError, "distinctProfitableInputListings: statement timeout");
assert.match(describeConcentration(listingsTimedOut), /collection groups \(Chroma \+ Chroma 2 \+ Dreams & Nightmares 3, Fever 1\); distinct profitable input listings unavailable \(distinctProfitableInputListings: statement timeout\)\./);

const malformed = shapeConcentration(originalBoard(), {
  groups: { ok: true, text: "{" },
  listings: { ok: true, text: JSON.stringify({ distinctProfitableInputListings: "4" }) },
});
assert.equal(malformed.distinctProfitableInputListings, null);
assert.equal(malformed.profitableByCollectionGroup, null);
assert.equal(malformed.profitableGroupCount, null);
assert.equal(malformed.concentrationError, "unexpected concentration payload");

const observed = applyRemoteObservation(remoteDetails({
  groups: { ok: false, message: "statement timeout" },
  listings: { ok: false, message: "statement timeout" },
}));
assert.equal(Object.hasOwn(observed, "concentrationQueries"), false);
assert.deepEqual(Object.keys(observed), [
  "observedAt",
  "prodHead",
  "processes",
  "board",
  "latestLoopOrCycle",
  "daemonOut",
  "daemonError",
  "breakSignalsInTail",
]);
assert.equal(observed.board.concentrationError, "statement timeout");
assert.equal(observed.board.maxScore, 36);
assert.equal(observed.prodHead, "3137ad23e9431768756cc1474ce3067891357d8f");
const untouched = remoteDetails({ groups: { ok: false, message: "statement timeout" }, listings: { ok: false, message: "statement timeout" } });
applyRemoteObservation(untouched);
assert.equal(untouched.board.maxScore, 36);
assert.equal(Object.hasOwn(untouched.board, "distinctProfitableInputListings"), false);
assert.equal(Object.hasOwn(untouched, "concentrationQueries"), true);

const timeoutError = new Error("Command failed: psql postgresql://role:secret@127.0.0.1/tradeupbot");
timeoutError.status = 1;
timeoutError.stderr = "ERROR:  canceling statement due to statement timeout\n";
const timeoutQuery = runOptionalQuery(() => {
  throw timeoutError;
}, "postgresql://role:secret@127.0.0.1/tradeupbot", GROUPS_SQL, CONCENTRATION_EXEC_TIMEOUT_MS);
assert.equal(timeoutQuery.ok, false);
assert.equal(timeoutQuery.message, "statement timeout");
assert.equal(JSON.stringify(timeoutQuery).includes("secret"), false);

const killed = new Error("spawnSync psql ETIMEDOUT");
killed.code = "ETIMEDOUT";
killed.signal = "SIGTERM";
const killedQuery = runOptionalQuery(() => {
  throw killed;
}, "postgresql://role:secret@127.0.0.1/tradeupbot", LISTINGS_SQL, CONCENTRATION_EXEC_TIMEOUT_MS);
assert.deepEqual(killedQuery, { ok: false, message: "statement timeout" });

let seenArgs = null;
const okQuery = runOptionalQuery((_file, args, options) => {
  seenArgs = { args, options };
  return ` ${JSON.stringify(listingsPayload)}\n`;
}, "postgresql://role:secret@127.0.0.1/tradeupbot_test", LISTINGS_SQL, CONCENTRATION_EXEC_TIMEOUT_MS);
assert.equal(okQuery.ok, true);
assert.equal(okQuery.text, JSON.stringify(listingsPayload));
assert.equal(seenArgs.args[0], "postgresql://role:secret@127.0.0.1/tradeupbot_test");
assert.ok(seenArgs.args.includes("ON_ERROR_STOP=1"));
assert.equal(seenArgs.args.at(-1), LISTINGS_SQL);
assert.equal(seenArgs.options.timeout, CONCENTRATION_EXEC_TIMEOUT_MS);
assert.deepEqual(seenArgs.options.stdio, ["ignore", "pipe", "pipe"]);
assert.equal(LISTINGS_SQL.includes("secret"), false);

assert.equal(ACTIVE_TRADE_UP_PREDICATE, "is_theoretical = false AND listing_status = 'active'");
assert.equal(PROFITABLE_TRADE_UP_PREDICATE, `${ACTIVE_TRADE_UP_PREDICATE} AND profit_cents > 0`);
assert.equal(BOARD_PSQL_TIMEOUT_MS, 30_000);
assert.ok(CONCENTRATION_STATEMENT_TIMEOUT_MS <= BOARD_PSQL_TIMEOUT_MS);
assert.ok(CONCENTRATION_EXEC_TIMEOUT_MS <= BOARD_PSQL_TIMEOUT_MS);
assert.ok(CONCENTRATION_STATEMENT_TIMEOUT_MS < CONCENTRATION_EXEC_TIMEOUT_MS);
assert.equal(PROFITABLE_GROUP_LIMIT, 10);

const sqlBlock = monitorSource.slice(monitorSource.indexOf("const SQL = String.raw`"), monitorSource.indexOf("const REMOTE_PROGRAM"));
for (const key of BOARD_OUTPUT_KEYS) assert.match(sqlBlock, new RegExp(`'${key}'`));
assert.equal(sqlBlock.includes("profit_cents"), false);
assert.equal(sqlBlock.includes("distinctProfitableInputListings"), false);
assert.match(sqlBlock, /WHERE is_theoretical = false AND listing_status = 'active'/);
assert.match(monitorSource, /timeout: 30000/);
for (const sql of [GROUPS_SQL, LISTINGS_SQL]) {
  assert.match(sql, new RegExp(ACTIVE_TRADE_UP_PREDICATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /profit_cents > 0/);
  assert.equal(sql.includes("profit_cents > 100"), false);
  assert.match(sql, /^BEGIN READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '2s';/);
  assert.match(sql, /\nCOMMIT;\n$/);
  assert.equal(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(sql), false);
}
assert.match(GROUPS_SQL, /LIMIT 10/);
assert.match(LISTINGS_SQL, /idx_trade_up_inputs_trade|trade_up_id = profitable\.id/);
assert.match(monitorSource, /applyRemoteObservation\(JSON\.parse/);
assert.ok(monitorSource.indexOf("applyRemoteObservation(JSON.parse") < monitorSource.indexOf("exitStatus = 0;"));
assert.equal(/concentrationError[\s\S]{0,240}exitStatus = 1/.test(monitorSource), false);

const state = mkdtempSync(join(tmpdir(), "trade-up-bot-engine-monitor-test-"));
try {
  const printed = spawnSync(process.execPath, [join(here, "bin", "engine-monitor.mjs"), "--print-remote"], {
    cwd: repo,
    env: { ...process.env, AUTORESEARCH_REPO_DIR: repo, AUTORESEARCH_STATE_DIR: state },
    encoding: "utf8",
  });
  assert.equal(printed.status, 0, printed.stderr || printed.stdout);
  assert.equal(printed.stdout.includes("__AUTORESEARCH"), false);
  assert.equal(printed.stdout.includes("heartbeatPath"), false);
  const remoteFile = join(state, "remote.mjs");
  writeFileSync(remoteFile, printed.stdout);
  const checked = spawnSync(process.execPath, ["--check", remoteFile], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(printed.stdout.includes("function runOptionalQuery"), true);
  assert.equal(printed.stdout.split("BEGIN READ ONLY;").length - 1, 2);

  const self = spawnSync(process.execPath, [join(here, "bin", "engine-monitor.mjs"), "--self-test"], {
    cwd: repo,
    env: { ...process.env, AUTORESEARCH_REPO_DIR: repo, AUTORESEARCH_STATE_DIR: state },
    encoding: "utf8",
  });
  assert.equal(self.status, 0, self.stderr || self.stdout);
  const payload = JSON.parse(self.stdout);
  assert.deepEqual(Object.keys(payload.heartbeat), [
    "schemaVersion",
    "kind",
    "runId",
    "timestamp",
    "startedAt",
    "finishedAt",
    "gitHead",
    "exitStatus",
    "whatItDid",
    "details",
    "selfTest",
    "error",
  ]);
  assert.equal(payload.heartbeat.schemaVersion, 1);
  assert.equal(payload.heartbeat.kind, "engine-monitor");
  assert.equal(payload.heartbeat.exitStatus, 0);
  assert.equal(payload.heartbeat.error, null);
  assert.equal(payload.heartbeat.selfTest, true);
  assert.equal(payload.heartbeat.whatItDid, "Verified the engine-monitor heartbeat path without contacting production.");
  assert.deepEqual(Object.keys(payload.heartbeat.details), [
    "observedAt",
    "prodHead",
    "processes",
    "board",
    "latestLoopOrCycle",
    "selfTest",
  ]);
  assert.equal(payload.heartbeat.details.board, null);

  const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
  let databaseName = "";
  if (databaseUrl) {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  }
  if (databaseName === "tradeupbot_test") {
    runLiveSql(databaseUrl);
  } else {
    process.stdout.write("SKIP live concentration SQL (TEST_DATABASE_URL is not tradeupbot_test)\n");
  }
} finally {
  rmSync(state, { recursive: true, force: true });
}

function psql(databaseUrl, sql, { tuples = false, searchPath = null } = {}) {
  const args = [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-q"];
  if (searchPath) args.push("-c", `SET search_path TO ${searchPath}`);
  if (tuples) args.push("-At");
  args.push("-c", sql);
  return spawnSync("psql", args, { encoding: "utf8" });
}

function runLiveSql(databaseUrl) {
  const schema = `em_conc_${process.pid}`;
  const drop = psql(databaseUrl, `DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  assert.equal(drop.status, 0, drop.stderr || drop.stdout);
  try {
    const created = psql(databaseUrl, `
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.trade_ups (
        id integer PRIMARY KEY,
        profit_cents integer NOT NULL,
        is_theoretical boolean NOT NULL,
        listing_status text NOT NULL,
        trade_up_score integer,
        collection_names text[] NOT NULL
      );
      CREATE INDEX idx_tu_active_profit ON ${schema}.trade_ups (profit_cents DESC)
        WHERE is_theoretical = false AND listing_status = 'active';
      CREATE TABLE ${schema}.trade_up_inputs (
        trade_up_id integer NOT NULL,
        listing_id text NOT NULL
      );
      CREATE INDEX idx_trade_up_inputs_trade ON ${schema}.trade_up_inputs (trade_up_id);
    `);
    assert.equal(created.status, 0, created.stderr || created.stdout);

    const tradeUps = [
      [1, 50, false, "active", 14, ["Dreams & Nightmares", "Chroma", "Chroma", "Chroma 2"]],
      [2, 50, false, "active", 9, ["Chroma", "Chroma 2", "Dreams & Nightmares"]],
      [3, 50, false, "active", null, ["Chroma", "Chroma 2", "Dreams & Nightmares"]],
      [4, 50, false, "active", 3, ["Gamma 2", "Dreams & Nightmares", "Chroma"]],
      [5, 50, false, "active", -4, ["Chroma", "Dreams & Nightmares", "Gamma 2"]],
      [6, 50, false, "active", 8, ["Fever"]],
    ];
    for (let index = 1; index <= 9; index += 1) {
      tradeUps.push([6 + index, 50, false, "active", index === 1 ? null : 1, [`Filler ${String(index).padStart(2, "0")}`]]);
    }
    tradeUps.push(
      [16, 50, true, "active", 99, ["Hidden Theory"]],
      [17, 50, false, "inactive", 99, ["Hidden Inactive"]],
      [18, 0, false, "active", 0, ["Hidden Zero"]],
      [19, -5, false, "active", -5, ["Hidden Loss"]],
    );
    const tradeSql = tradeUps.map(([id, profit, theoretical, status, score, collections]) => {
      const names = collections.map((name) => `'${name.replaceAll("'", "''")}'`).join(", ");
      const scoreSql = score === null ? "NULL" : String(score);
      return `(${id}, ${profit}, ${theoretical}, '${status}', ${scoreSql}, ARRAY[${names}]::text[])`;
    }).join(",\n");
    const inputs = [
      [1, "a"], [1, "b"],
      [2, "b"], [2, "c"],
      [3, "a"], [3, "c"],
      [4, "a"], [4, "d"],
      [5, "d"],
      [6, "e"],
      [16, "hidden-theory"],
      [17, "hidden-inactive"],
      [18, "hidden-zero"],
      [19, "hidden-loss"],
    ];
    for (let index = 1; index <= 9; index += 1) inputs.push([6 + index, `f${String(index).padStart(2, "0")}`]);
    const inputSql = inputs.map(([id, listing]) => `(${id}, '${listing}')`).join(", ");
    const inserted = psql(databaseUrl, `
      INSERT INTO trade_ups (id, profit_cents, is_theoretical, listing_status, trade_up_score, collection_names)
      VALUES ${tradeSql};
      INSERT INTO trade_up_inputs (trade_up_id, listing_id) VALUES ${inputSql};
    `, { searchPath: schema });
    assert.equal(inserted.status, 0, inserted.stderr || inserted.stdout);

    const groups = psql(databaseUrl, GROUPS_SQL, { tuples: true, searchPath: schema });
    assert.equal(groups.status, 0, groups.stderr || groups.stdout);
    const listings = psql(databaseUrl, LISTINGS_SQL, { tuples: true, searchPath: schema });
    assert.equal(listings.status, 0, listings.stderr || listings.stdout);
    const live = shapeConcentration(originalBoard(), {
      groups: { ok: true, text: groups.stdout },
      listings: { ok: true, text: listings.stdout },
    });
    assert.equal(live.concentrationError, null);
    assert.equal(live.distinctProfitableInputListings, 14);
    assert.equal(live.profitableGroupCount, 12);
    assert.equal(live.profitableByCollectionGroup.length, 10);
    assert.deepEqual(live.profitableByCollectionGroup, [
      { collections: ["Chroma", "Chroma 2", "Dreams & Nightmares"], count: 3, maxScore: 14 },
      { collections: ["Chroma", "Dreams & Nightmares", "Gamma 2"], count: 2, maxScore: 3 },
      { collections: ["Fever"], count: 1, maxScore: 8 },
      { collections: ["Filler 01"], count: 1, maxScore: null },
      { collections: ["Filler 02"], count: 1, maxScore: 1 },
      { collections: ["Filler 03"], count: 1, maxScore: 1 },
      { collections: ["Filler 04"], count: 1, maxScore: 1 },
      { collections: ["Filler 05"], count: 1, maxScore: 1 },
      { collections: ["Filler 06"], count: 1, maxScore: 1 },
      { collections: ["Filler 07"], count: 1, maxScore: 1 },
    ]);
    assertExistingBoardUntouched(originalBoard(), live);

    const slept = runOptionalQuery(
      execFileSync,
      databaseUrl,
      "BEGIN READ ONLY; SET LOCAL statement_timeout = '200ms'; SELECT pg_sleep(1); COMMIT;",
      CONCENTRATION_EXEC_TIMEOUT_MS,
    );
    assert.equal(slept.ok, false);
    assert.equal(slept.message, "statement timeout");
  } finally {
    psql(databaseUrl, `DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}

process.stdout.write("PASS engine-monitor concentration\n");
