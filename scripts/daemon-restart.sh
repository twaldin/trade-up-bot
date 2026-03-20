#!/bin/bash
# Queue a graceful daemon restart at end of current cycle.
# The daemon finishes its current cycle, exits cleanly, and PM2 auto-restarts it.
#
# Usage:
#   ./scripts/daemon-restart.sh          # local
#   ssh root@<VPS> "cd /opt/trade-up-bot && bash scripts/daemon-restart.sh"

set -e

echo "Sending SIGUSR2 to daemon (queue restart at end of cycle)..."
pm2 sendSignal SIGUSR2 daemon 2>/dev/null || {
  echo "pm2 sendSignal failed — trying pkill..."
  pkill -USR2 -f "server/daemon.ts" || echo "No daemon process found"
}

echo "Restart queued. Daemon will exit at end of current cycle and PM2 will auto-restart."
echo "Monitor with: pm2 logs daemon --lines 5 --nostream"
