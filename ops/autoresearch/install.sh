#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_REPO="/home/tim/omp-firstmate/projects/trade-up-bot"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
readonly SOURCE_UNIT_DIR="${SCRIPT_DIR}/systemd"
readonly USER_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
readonly TARGET_UNIT_DIR="${USER_CONFIG_HOME}/systemd/user"
readonly STATE_DIR="${AUTORESEARCH_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/trade-up-bot/autoresearch}"

readonly -a TIMERS=(
  trade-up-bot-autoresearch-fire.timer
  trade-up-bot-engine-monitor.timer
  trade-up-bot-autoresearch-watchdog.timer
)
readonly -a SERVICES=(
  trade-up-bot-autoresearch-fire.service
  trade-up-bot-engine-monitor.service
  trade-up-bot-autoresearch-watchdog.service
)
readonly -a UNITS=("${TIMERS[@]}" "${SERVICES[@]}")

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

assert_expected_checkout() {
  [[ "${REPO_DIR}" == "${EXPECTED_REPO}" ]] || fail "install must run from ${EXPECTED_REPO}; observed ${REPO_DIR}"
  [[ "$(git -C "${REPO_DIR}" rev-parse --show-toplevel)" == "${EXPECTED_REPO}" ]] || fail "expected checkout is not a git worktree"
}

assert_loaded() {
  local unit load_state
  for unit in "${UNITS[@]}"; do
    load_state="$(systemctl --user show "${unit}" --property=LoadState --value)"
    [[ "${load_state}" == "loaded" ]] || fail "${unit} LoadState=${load_state:-missing}, expected loaded"
  done
}

assert_timer_finite() {
  local timer next next_epoch now_epoch active
  now_epoch="$(date +%s)"
  for timer in "${TIMERS[@]}"; do
    active="$(systemctl --user is-active "${timer}")"
    [[ "${active}" == "active" ]] || fail "${timer} is not active"
    next="$(systemctl --user show "${timer}" --property=NextElapseUSecRealtime --value)"
    [[ -n "${next}" && "${next}" != "n/a" && "${next}" != "0" ]] || fail "${timer} has no finite next elapse"
    next_epoch="$(date --date="${next}" +%s)" || fail "${timer} next elapse is not parseable: ${next}"
    (( next_epoch > now_epoch )) || fail "${timer} next elapse is not in the future: ${next}"
    printf 'verified timer: %s next=%s\n' "${timer}" "${next}"
  done
}

assert_service_success() {
  local service result status
  for service in "$@"; do
    result="$(systemctl --user show "${service}" --property=Result --value)"
    status="$(systemctl --user show "${service}" --property=ExecMainStatus --value)"
    [[ "${result}" == "success" && "${status}" == "0" ]] || fail "${service} result=${result:-missing} status=${status:-missing}"
    printf 'verified one-shot: %s result=%s status=%s\n' "${service}" "${result}" "${status}"
  done
}

assert_fresh_artifacts() {
  AUTORESEARCH_STATE_DIR="${STATE_DIR}" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    const state = process.env.AUTORESEARCH_STATE_DIR;
    const status = JSON.parse(readFileSync(join(state, "watchdog-status.json"), "utf8"));
    if (status.status !== "OK") throw new Error(`watchdog status is ${status.status}`);
    for (const check of status.checks) {
      if (check.status !== "OK" || check.latestExitStatus !== 0) throw new Error(`${check.kind} is ${check.status}`);
    }
    process.stdout.write(`verified watchdog artifact: ${join(state, "watchdog-status.json")} status=OK\n`);
  '
}

run_runtime_proof() {
  node "${SCRIPT_DIR}/test-runtime.mjs"
}

verify_installed() {
  assert_loaded
  assert_service_success "${SERVICES[@]}"
  assert_timer_finite
  assert_fresh_artifacts
}

install_units() {
  assert_expected_checkout
  for command in git node omp gh ssh systemctl systemd-analyze date install; do
    require_command "${command}"
  done

  run_runtime_proof
  systemd-analyze verify "${SOURCE_UNIT_DIR}"/*.service "${SOURCE_UNIT_DIR}"/*.timer
  install -d -m 0755 "${TARGET_UNIT_DIR}"
  for unit in "${UNITS[@]}"; do
    install -m 0644 "${SOURCE_UNIT_DIR}/${unit}" "${TARGET_UNIT_DIR}/${unit}"
  done
  systemctl --user daemon-reload
  assert_loaded

  # Monitoring runs first so the autonomous fire never starts from unknown health.
  systemctl --user reset-failed "${SERVICES[@]}" >/dev/null 2>&1 || true
  systemctl --user start trade-up-bot-engine-monitor.service
  assert_service_success trade-up-bot-engine-monitor.service
  systemctl --user start trade-up-bot-autoresearch-fire.service
  assert_service_success trade-up-bot-autoresearch-fire.service
  systemctl --user start trade-up-bot-autoresearch-watchdog.service
  assert_service_success trade-up-bot-autoresearch-watchdog.service
  assert_fresh_artifacts

  systemctl --user enable --now "${TIMERS[@]}"
  verify_installed
  printf 'installed and verified; read status with: cat %q\n' "${STATE_DIR}/watchdog-status.json"
}

rollback_units() {
  require_command systemctl
  systemctl --user disable --now "${TIMERS[@]}" >/dev/null 2>&1 || true
  systemctl --user stop "${SERVICES[@]}" >/dev/null 2>&1 || true
  for unit in "${UNITS[@]}"; do
    rm -f -- "${TARGET_UNIT_DIR}/${unit}"
  done
  systemctl --user daemon-reload
  systemctl --user reset-failed "${UNITS[@]}" >/dev/null 2>&1 || true
  printf 'rolled back units; preserved state at %s and optional environment at %s\n' \
    "${STATE_DIR}" "${USER_CONFIG_HOME}/trade-up-bot/autoresearch.env"
}

case "${1:-}" in
  install) install_units ;;
  verify) verify_installed ;;
  rollback) rollback_units ;;
  *) fail "usage: $0 {install|verify|rollback}" ;;
esac
