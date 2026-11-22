#!/usr/bin/env bash
# Downloads the USGS one-meter lidar tiles listed by lidar-list.ts. Safe to rerun: finished files are skipped
# and partial ones resume.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p data/sources/lidar
xargs -P 4 -I{} bash -c '
  url="$1"
  out="data/sources/lidar/$(basename "$url")"
  want=$(curl -sSIL "$url" | tr -d "\r" | awk -F": " "tolower(\$1)==\"content-length\"{n=\$2} END{print n}")
  have=$(stat -f %z "$out" 2>/dev/null || stat -c %s "$out" 2>/dev/null || echo 0)
  if [ -n "$want" ] && [ "$have" = "$want" ]; then echo "have $(basename "$out")"; exit 0; fi
  curl -sS -L --retry 5 --retry-delay 5 -C - -o "$out" "$url" && echo "got $(basename "$out")"
' _ {} < data/sources/lidar-urls.txt
echo "lidar done"
