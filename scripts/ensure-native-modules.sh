#!/bin/bash
# Prove better-sqlite3 matches this Node before the caller restarts PM2.
# NODE_MODULE_VERSION is 115 on Node 20 and 137 on Node 24. The lockfile
# marker does not change when only the Node binary changes.
set -euo pipefail

if [ -n "${TRADEUP_ROOT:-}" ]; then
  cd "$TRADEUP_ROOT"
else
  cd "$(dirname "$0")/.."
fi

abi="$(node -p 'process.versions.modules')"
abi_marker="node_modules/.tradeup-node-abi"

rebuild_native() {
  npm rebuild better-sqlite3 || return 1
  if [ -d node_modules/sharp ]; then
    npm rebuild sharp || echo "warning: sharp rebuild failed" >&2
  fi
  return 0
}

ensure_native() {
  local mismatch=0
  if [ -f "$abi_marker" ] && [ "$(cat "$abi_marker")" != "$abi" ]; then
    mismatch=1
  fi
  if [ "$mismatch" -eq 0 ] && node scripts/check-native-modules.mjs; then
    if [ ! -f "$abi_marker" ]; then
      printf '%s\n' "$abi" > "$abi_marker"
    fi
    return 0
  fi
  rebuild_native || return 1
  if node scripts/check-native-modules.mjs; then
    printf '%s\n' "$abi" > "$abi_marker"
    return 0
  fi
  return 1
}

if ! ensure_native; then
  echo "native preflight failed; not restarting PM2" >&2
  exit 1
fi
