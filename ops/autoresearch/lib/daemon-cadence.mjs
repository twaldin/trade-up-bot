// Discovery-cycle cadence from the daemon stdout tail.
//
// server/daemon/index.ts prints the real cycle as
//   [YYYY-MM-DD HH:MM:SS] Cycle N complete (X.X min)
// timestamp() in server/daemon/utils.ts is UTC ISO with "T" replaced by a space, sliced to 19 characters.
// Listing and sale round-robins in server/daemon/phases/data-fetch.ts print a different counter, "(loop N)".
// Buff and DMarket fetchers print "Cycle N complete:" into their own logs. latestLoopOrCycle stays the
// last loop|cycle number so existing heartbeats keep that field. lastCompletedCycle is only the daemon line.

export function parseDaemonCadence(text) {
  const tail = typeof text === "string" ? text : "";
  const loopNumbers = [...tail.matchAll(/(?:loop|cycle)\s+#?(\d+)/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
  let lastCompletedCycle = null;
  let lastCompletedCycleAt = null;
  for (const match of tail.matchAll(/(?:\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] )?Cycle (\d+) complete \(/g)) {
    const cycle = Number(match[2]);
    if (!Number.isInteger(cycle) || cycle < 0) continue;
    lastCompletedCycle = cycle;
    lastCompletedCycleAt = match[1] || null;
  }
  return {
    latestLoopOrCycle: loopNumbers.at(-1) ?? null,
    daemon: {
      lastCompletedCycle,
      lastCompletedCycleAt,
    },
  };
}
