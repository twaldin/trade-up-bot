#!/bin/bash
# Fresh restart: queue graceful stop, wait for exit, purge data, restart with --fresh.
# This replaces the manual stop→DELETE→FLUSHALL→restart workflow.
#
# Usage:
#   ./scripts/daemon-fresh.sh            # local
#   ssh root@<VPS> "cd /opt/trade-up-bot && bash scripts/daemon-fresh.sh"

set -e

echo "=== Daemon Fresh Restart ==="

# 1. Queue graceful stop
echo "1/4 Sending SIGUSR2 to daemon..."
pm2 sendSignal SIGUSR2 daemon 2>/dev/null || true

# 2. Wait for daemon to actually exit (max 35 min = longest possible cycle)
echo "2/4 Waiting for daemon to finish current cycle..."
TIMEOUT=2100
ELAPSED=0
while pm2 jlist 2>/dev/null | grep -q '"name":"daemon".*"status":"online"'; do
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "  Timeout waiting for graceful exit — force stopping..."
    pm2 stop daemon 2>/dev/null || true
    sleep 2
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "  Still waiting... (${ELAPSED}s elapsed)"
  fi
done
echo "  Daemon stopped."

# 3. Purge trade-up data + Redis cache
echo "3/4 Purging trade-up data and Redis cache..."
if command -v psql &>/dev/null; then
  # Local: use psql directly
  psql -d tradeupbot -c "DELETE FROM trade_up_inputs; DELETE FROM trade_ups;" 2>/dev/null || true
elif command -v sudo &>/dev/null; then
  # VPS: use sudo -u postgres
  sudo -u postgres psql -d tradeupbot -c "DELETE FROM trade_up_inputs; DELETE FROM trade_ups;" 2>/dev/null || true
fi
redis-cli FLUSHALL 2>/dev/null || echo "  Redis not available (non-critical)"

# 4. Restart daemon (PM2 will use existing start config)
echo "4/4 Restarting daemon..."
pm2 restart daemon 2>/dev/null || pm2 start "npx tsx server/daemon.ts" --name daemon

echo ""
echo "=== Fresh restart complete ==="
echo "Monitor with: pm2 logs daemon --lines 10 --nostream"
