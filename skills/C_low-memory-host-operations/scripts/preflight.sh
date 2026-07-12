#!/usr/bin/env bash
# Read-only resource gate for Cubica builds on a shared low-memory host.
#
# The script deliberately performs no cleanup. Process ownership cannot be
# inferred safely from a name alone, so the caller must investigate any conflict
# instead of terminating it automatically.

set -u

readonly MIN_AVAILABLE_KIB=$((2 * 1024 * 1024))
readonly MIN_SWAP_FREE_PERCENT=20

mem_available_kib=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
swap_total_kib=$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)
swap_free_kib=$(awk '/^SwapFree:/ { print $2 }' /proc/meminfo)

status=0

printf 'Memory available: %s MiB\n' "$((mem_available_kib / 1024))"

if (( mem_available_kib < MIN_AVAILABLE_KIB )); then
  printf 'BLOCKED: at least 2048 MiB available memory is required.\n' >&2
  status=1
fi

if (( swap_total_kib == 0 )); then
  printf 'BLOCKED: no swap is active.\n' >&2
  status=1
else
  swap_free_percent=$((swap_free_kib * 100 / swap_total_kib))
  printf 'Swap free: %s MiB (%s%%)\n' \
    "$((swap_free_kib / 1024))" "$swap_free_percent"
  if (( swap_free_percent < MIN_SWAP_FREE_PERCENT )); then
    printf 'BLOCKED: free swap is below 20%%.\n' >&2
    status=1
  fi
fi

# Bracket notation prevents pgrep from matching its own search command.
existing_builds=$(pgrep -af '[n]ext build' || true)
if [[ -n "$existing_builds" ]]; then
  printf 'BLOCKED: another Next.js build is already running:\n%s\n' \
    "$existing_builds" >&2
  status=1
else
  printf 'Next.js build writers: none\n'
fi

printf 'Relevant listening ports:\n'
ss -ltnp '( sport = :3000 or sport = :3001 or sport = :3002 or sport = :3200 or sport = :3201 )' \
  2>/dev/null || true

printf 'Protected network process names (read-only check):\n'
pgrep -aif '(^|/)(necobox|necoray|vray)( |$)' || printf 'none currently visible\n'

if (( status == 0 )); then
  printf 'READY: resource preflight passed.\n'
fi

exit "$status"
