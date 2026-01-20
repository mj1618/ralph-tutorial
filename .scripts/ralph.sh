#!/usr/bin/env bash
set -euo pipefail

# Like scripts/convert.sh, but pretty-prints the agent's stream-json output line-by-line.
# NOTE: We do NOT edit scripts/convert.sh (workspace rule).

cleanup() {
  echo "Ctrl+C detected! Performing cleanup..."
  exit 1
}
trap cleanup SIGINT

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"

for i in $(seq 1 10000); do
  # Run agent and pretty-print each line to stdout via node parser
  # NOTE: With `set -euo pipefail`, a failure in either `agent` or `node -e` would
  # abort the entire script. We want to continue the loop instead.
  set +e
  agent --model gpt-5.2-codex --output-format stream-json --stream-partial-output --sandbox disabled --print --force "$(cat "${ROOT_DIR}/.seed/RALPH.md")" \
    2>&1 \
    | node -e "$(cat ./.scripts/pretty-log-line.js)"
  status=$?
  set -e

  if [[ $status -ne 0 ]]; then
    echo "Iteration ${i} failed (exit $status); continuing..." >&2
  fi
done

