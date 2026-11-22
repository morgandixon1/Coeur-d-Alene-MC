#!/usr/bin/env bash
# Start the viewer on this computer. Then open http://localhost:4317
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 from https://nodejs.org and run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

echo "Open http://localhost:4317 in your browser."
exec npm run dev
