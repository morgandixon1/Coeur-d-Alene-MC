#!/usr/bin/env bash
# Build the 20-mile Coeur d'Alene / Spokane Valley square as nine Bedrock worlds.
# One world of the whole square exhausted this machine's memory, so Arnis runs
# one tile at a time. Scale 0.3 is the smallest that still places houses and roads.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/inland-northwest/tiles"
mkdir -p "$OUT"

if ! command -v arnis >/dev/null; then
  echo "Arnis is not on PATH. Download the Linux build from https://github.com/louis-e/arnis/releases/tag/v3.4.0" >&2
  exit 1
fi

# id|bbox|spawn lat|spawn lng  — center tile first, then the valley and the lake.
tiles=(
  "middle-center|47.607352,-117.013763,47.800109,-116.727335|47.7037303|-116.8705491"
  "middle-west|47.607352,-117.300192,47.800109,-117.013763|47.703731|-117.156978"
  "middle-east|47.607352,-116.727335,47.800109,-116.440906|47.703731|-116.584120"
  "south-center|47.414596,-117.013763,47.607352,-116.727335|47.510974|-116.870549"
  "north-center|47.800109,-117.013763,47.992865,-116.727335|47.896487|-116.870549"
  "north-east|47.800109,-116.727335,47.992865,-116.440906|47.896487|-116.584120"
  "north-west|47.800109,-117.300192,47.992865,-117.013763|47.896487|-117.156978"
  "south-west|47.414596,-117.300192,47.607352,-117.013763|47.510974|-117.156978"
  "south-east|47.414596,-116.727335,47.607352,-116.440906|47.510974|-116.584120"
)

fail=0
for entry in "${tiles[@]}"; do
  IFS='|' read -r id bbox spawn_lat spawn_lng <<<"$entry"
  dir="$OUT/$id"
  mkdir -p "$dir"
  if [[ -f "$dir/generate.log" ]] && grep -q '^EXIT:0$' "$dir/generate.log" && compgen -G "$dir/*.mcworld" >/dev/null; then
    echo "skip $id"
    continue
  fi
  {
    echo "START $(date -Is)"
    set +e
    arnis \
      --bedrock \
      --scale 0.3 \
      --bbox="$bbox" \
      --spawn-lat "$spawn_lat" \
      --spawn-lng "$spawn_lng" \
      --output-dir "$dir" \
      --map-preview \
      --no-3d \
      --gamemode creative \
      --world-time 6000 \
      --signage none
    code=$?
    set -e
    echo "EXIT:$code"
  } >"$dir/generate.log" 2>&1
  echo "$id EXIT:$code"
  if [[ "$code" -ne 0 ]]; then
    fail=1
  fi
done

exit "$fail"
