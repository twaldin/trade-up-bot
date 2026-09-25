/**
 * Trade-Up Bot Daemon — multi-type with float-aware theory.
 *
 * Phases: Housekeeping → Theory (knife+classified+staircase) → Probe → Fetch →
 *         Calc (knife+classified+staircase) → Cooldown → Re-materialize
 */

import { installDaemonLogTee } from "./daemon/log-tee.js";
import { main } from "./daemon/index.js";

// Truncates the log on each daemon start so DaemonModal shows the current session.
installDaemonLogTee("/tmp/daemon.log");

main().catch((err) => {
  console.error("Daemon crashed:", err);
  process.exit(1);
});
