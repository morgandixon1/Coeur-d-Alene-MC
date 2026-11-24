# Coeur d’Alene Minecraft generators

Generate furnished Coeur d’Alene houses, procedural Minecraft terrain, or Bedrock map sections from Inland Northwest geography. This repository contains the app, generator source, and small input recipes. Generated worlds, map tiles, and downloaded datasets live under the ignored `data/` directory.

## Start the app

Install Node.js 22 or newer and run these commands.

```sh
npm ci
npm run dev
```

| Local page | What you can generate |
| --- | --- |
| [House Studio](http://localhost:4317/houses) | Pick a style, era, tier, and seed. Compare six designs, inspect floor plans and loot, and export a furnished house as a standalone Bedrock world. No geographic data is needed. |
| [Commercial Studio](http://localhost:4317/commercial) | Pick a commercial building type, era, scale, and seed. Compare six designs, inspect floor plans and stocked chests, customize block materials, and export a standalone Bedrock world. No geographic data is needed. |
| [Terrain Generator](http://localhost:4317/terrain) | Create a small procedural world with a controlled seed, terrain style, and spawn. No geographic data is needed. |
| [Regional Map](http://localhost:4317/) | View locally built Inland Northwest map tiles and export a selected area as a Bedrock world. |
| [Arnis Archive](http://localhost:4317/arnis) | Preview local Bedrock archives under `data/archive/arnis/worlds/` or `data/archive/arnis/inland-northwest/`. |

Open exported `.mcworld` files with Minecraft Bedrock Edition. The house export uses the same brief and seed as the preview, including furniture, beds, and tiered chest inventories.

## Build regional data locally

The one-meter regional grid is centered on downtown Coeur d’Alene. It uses USGS 3DEP lidar for elevation and [OpenStreetMap](https://www.openstreetmap.org/copyright) for roads and water. The included lidar download list totals about 14 GB before conversion. Run the commands from the repository root.

```sh
mkdir -p data/sources/osm
cp scripts/inw/sources/lidar-{files.json,urls.txt} data/sources/
bash scripts/inw/fetch-lidar.sh
python3 -m venv .venv
. .venv/bin/activate
pip install numpy tifffile imagecodecs
python scripts/inw/lidar-to-raw.py
node --import tsx scripts/inw/build-terrain.ts

for layer in roads water; do
  curl --fail --show-error --silent \
    --data-urlencode "data@scripts/inw/sources/osm/${layer}.overpassql" \
    https://overpass-api.de/api/interpreter \
    -o "data/sources/osm/${layer}.json"
done
node --import tsx scripts/inw/pack-roads.ts
```

To add water, place the Coeur d’Alene Tribe bathymetry survey's `.shp` and `.dbf` files at `data/sources/bathymetry/bathymetry_cdabasin_cdatribe.{shp,dbf}` before running `node --import tsx scripts/inw/build-water.ts`. The survey is a separate input.

```sh
node --import tsx scripts/inw/build-view.ts
node --import tsx scripts/inw/build-mcworld.ts --center 0,0 --size 512
```

The CLI writes exports under `data/world/exports/`. The separate `scripts/generate-inland-northwest.sh` workflow uses [Arnis 3.4](https://github.com/louis-e/arnis/releases/tag/v3.4.0) on `PATH` to generate its nine larger map tiles under `data/inland-northwest/tiles/`.

## Checks

Run `npm test` for generator and export tests, including Bedrock LevelDB round trips.
