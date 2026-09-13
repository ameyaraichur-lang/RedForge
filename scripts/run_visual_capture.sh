#!/usr/bin/env bash
# Bounded visual capture acceptance — pipefail preserves non-zero exit from capture/sanity.
# Do not pipe capture output through grep; grep exit 0 on no-match masks capture failures.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v uv >/dev/null 2>&1; then
  PY=(uv run python)
elif command -v python3 >/dev/null 2>&1; then
  PY=(python3)
else
  PY=(python)
fi

"${PY[@]}" scripts/capture_visual_fidelity.py
CAP_EXIT=$?
if [[ "$CAP_EXIT" -ne 0 ]]; then
  echo "visual capture failed with exit $CAP_EXIT" >&2
  exit "$CAP_EXIT"
fi
"${PY[@]}" scripts/check_visual_sanity.py
