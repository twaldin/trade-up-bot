#!/bin/bash
# Backfill output_skin_names for existing trade-ups.
# Runs in batches of 50K to avoid locking the daemon.
# Safe to run while daemon is active — batched updates minimize deadlock risk.

set -e

BATCH=50000
TOTAL=$(sudo -u postgres psql -d tradeupbot -tAc "SELECT COUNT(*) FROM trade_ups WHERE output_skin_names = '{}' AND outcomes_json IS NOT NULL AND outcomes_json != '[]'")
echo "Backfilling output_skin_names: $TOTAL rows remaining"

i=0
while true; do
  REMAINING=$(sudo -u postgres psql -d tradeupbot -tAc "SELECT COUNT(*) FROM trade_ups WHERE output_skin_names = '{}' AND outcomes_json IS NOT NULL AND outcomes_json != '[]'")
  if [ "$REMAINING" = "0" ]; then
    echo "Done! All rows backfilled."
    break
  fi
  i=$((i + 1))
  echo "Batch $i: $REMAINING remaining..."
  sudo -u postgres psql -d tradeupbot -c "
    UPDATE trade_ups SET output_skin_names = (
      SELECT COALESCE(array_agg(DISTINCT elem->>'skin_name' ORDER BY elem->>'skin_name'), '{}')
      FROM json_array_elements(outcomes_json::json) AS elem
    )
    WHERE id IN (
      SELECT id FROM trade_ups
      WHERE outcomes_json IS NOT NULL AND outcomes_json != '[]'
        AND output_skin_names = '{}'
      ORDER BY id LIMIT $BATCH
    );
  "
  echo "  Batch $i complete."
  sleep 2  # Brief pause to let autovacuum breathe
done

echo "Verifying..."
sudo -u postgres psql -d tradeupbot -c "SELECT COUNT(*) FILTER (WHERE array_length(output_skin_names, 1) > 0) as populated, COUNT(*) FILTER (WHERE output_skin_names = '{}') as empty FROM trade_ups;"
