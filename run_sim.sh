#!/usr/bin/env bash
# Forwarding launcher to vasimov simulator
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VASIMOV_DIR="/home/shubhr/Shubhr/Projects/vasimov"

if [ -f "$VASIMOV_DIR/run_sim.sh" ]; then
    exec "$VASIMOV_DIR/run_sim.sh" "$@"
else
    echo "ERROR: vasimov repository not found at $VASIMOV_DIR" >&2
    exit 1
fi
