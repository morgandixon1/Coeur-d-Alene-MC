/**
 * Water layer. For every block that is water: the water surface and the bed under it, in decimeters,
 * plus a flags plane (1 lake, 2 river, 3 stream or ditch; +8 where the bed comes from surveyed depth).
 * Writes data/world/water/0/<tx>_<tz>.bin (three planes) only for tiles that have water, and
 * data/world/water/features.json describing each lake and river.
 *
 *   node --import tsx scripts/inw/build-water.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { NODATA, WORLD, worldTiles } from "../../src/lib/inw/grid.ts";
import { SOURCES_DIR, WORLD_DIR, tileFile, writeTile } from "../../src/lib/inw/store.ts";
import { loadContours, type Contour } from "./lib/contours.ts";
import { loadOsmWater, type WaterArea } from "./lib/osm-water.ts";
import { distanceTo, fillRings, relax, strokeLine, type Grid } from "./lib/raster.ts";

const SIZE = WORLD.tileSize;
const R = WORLD.radiusMeters;
const FEET = 0.3048;
/** Coeur d'Alene Lake's summer pool, the level the tribe's depth contours are measured from. */
const LAKE_POOL_FEET = 2128;
/** Beyond this distance from a surveyed contour, depth falls back to the estimate. */
const SURVEY_REACH = 400;
const MAX_FEATURE_CELLS = 16e6;

const FLAG_LAKE = 1;
const FLAG_RIVER = 2;
const FLAG_STREAM = 3;
const FLAG_SURVEYED = 8;

class Terrain {
  private cache = new Map<string, Int16Array | null>();

  tile(tx: number, tz: number): Int16Array | null {
    const key = `${tx},${tz}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const file = tileFile("terrain", 0, tx, tz);
    let cells: Int16Array | null = null;
    if (existsSync(file)) {
      const raw = inflateSync(readFileSync(file));
      cells = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    }
    this.cache.set(key, cells);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    return cells;
  }

  /** Decimeters at block (x, z), or NODATA. */
  at(x: number, z: number): number {
    const tx = Math.floor(x / SIZE);
    const tz = Math.floor(z / SIZE);
    const cells = this.tile(tx, tz);
    if (!cells) return NODATA;
    return cells[(Math.floor(z) - tz * SIZE) * SIZE + (Math.floor(x) - tx * SIZE)];
  }
}

type Model = {
  area: WaterArea;
  grid: Grid;
  mask: Uint8Array;
  /** Water surface per cell, decimeters. Constant for lakes. */
  surface: Float32Array;
  /** Depth below the surface per cell, meters. */
  depth: Float32Array;
  /** 1 where the depth comes from surveyed contours, 0 where it is estimated. */
  surveyed: Float32Array;
  lakeLevel: number | null;
  maxDepth: number;
  surveyedShare: number;
};

function clipBox(box: { x0: number; z0: number; x1: number; z1: number }, margin: number) {
  return {
    x0: Math.max(-R - margin, Math.floor(box.x0) - margin),
    z0: Math.max(-R - margin, Math.floor(box.z0) - margin),
    x1: Math.min(R + margin, Math.ceil(box.x1) + margin),
    z1: Math.min(R + margin, Math.ceil(box.z1) + margin),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function estimateDepth(area: WaterArea, distance: number): number {
  if (area.kind === "river") return Math.min(4, 0.4 + distance * 0.2);
  const deepest = Math.max(1, Math.min(25, 0.5 * area.area ** 0.2));
  return Math.min(deepest, 0.4 + distance * 0.12);
}

function buildModel(area: WaterArea, terrain: Terrain, contours: Contour[], contourShift: number | null): Model | null {
  const box = clipBox(area.bbox, 8);
  if (box.x1 <= box.x0 || box.z1 <= box.z0) return null;
  const res = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(((box.x1 - box.x0) * (box.z1 - box.z0)) / MAX_FEATURE_CELLS))));
  const grid: Grid = {
    x0: box.x0,
    z0: box.z0,
    res,
    width: Math.ceil((box.x1 - box.x0) / res),
    height: Math.ceil((box.z1 - box.z0) / res),
  };
  const cells = grid.width * grid.height;
  const mask = new Uint8Array(cells);
  fillRings(grid, area.rings, (i) => (mask[i] = 1));
  const ground = new Float32Array(cells).fill(NaN);
  const samples: number[] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt(cells / 200000)));
  for (let row = 0; row < grid.height; row += 1) {
    for (let col = 0; col < grid.width; col += 1) {
      const i = row * grid.width + col;
      if (!mask[i]) continue;
      const value = terrain.at(grid.x0 + (col + 0.5) * res, grid.z0 + (row + 0.5) * res);
      if (value === NODATA) continue;
      ground[i] = value;
      if (row % stride === 0 && col % stride === 0) samples.push(value);
    }
  }
  if (samples.length === 0) return null;

  const surface = new Float32Array(cells);
  let lakeLevel: number | null = null;
  if (area.kind === "lake") {
    lakeLevel = median(samples);
    surface.fill(lakeLevel);
  } else {
    for (let row = 0; row < grid.height; row += 1) {
      for (let col = 0; col < grid.width; col += 1) {
        const i = row * grid.width + col;
        if (!mask[i]) continue;
        let low = Infinity;
        for (let dz = -2; dz <= 2; dz += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const c = col + dx;
            const r = row + dz;
            if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
            const value = ground[r * grid.width + c];
            if (value < low) low = value;
          }
        }
        surface[i] = Number.isFinite(low) ? low : NaN;
      }
    }
  }
  for (let i = 0; i < cells; i += 1) {
    if (!mask[i]) continue;
    if (Number.isNaN(surface[i]) || Number.isNaN(ground[i]) || ground[i] > surface[i] + 20) mask[i] = 0;
  }

  const shore = new Uint8Array(cells);
  for (let i = 0; i < cells; i += 1) shore[i] = mask[i] ? 0 : 1;
  const fromShore = distanceTo(grid, shore);
  const depth = new Float32Array(cells);
  let maxDepth = 0;
  for (let i = 0; i < cells; i += 1) if (mask[i]) depth[i] = estimateDepth(area, fromShore[i]);

  const surveyed = new Float32Array(cells);
  const contourCells = new Uint8Array(cells);
  let surveyedCount = 0;
  if (contourShift !== null) {
    const touching = contours.filter((contour) =>
      contour.parts.some((part) => {
        for (let i = 0; i < part.length; i += 2) {
          if (part[i] >= box.x0 && part[i] <= box.x1 && part[i + 1] >= box.z0 && part[i + 1] <= box.z1) return true;
        }
        return false;
      }),
    );
    for (const contour of touching) {
      const bed = (contour.elevationFeet * FEET + contourShift) * 10;
      for (const part of contour.parts) {
        strokeLine(grid, part, res * 0.5, (i) => {
          if (!mask[i]) return;
          const below = (surface[i] - bed) / 10;
          if (below <= 0.2) return;
          contourCells[i] = 1;
          depth[i] = below;
        });
      }
    }
    const hits = contourCells.reduce((sum, value) => sum + value, 0);
    if (hits > 0) {
      const fromContour = distanceTo(grid, contourCells);
      const fixed = new Uint8Array(cells);
      for (let i = 0; i < cells; i += 1) {
        if (!mask[i] || contourCells[i] || fromContour[i] > SURVEY_REACH) fixed[i] = 1;
        if (!mask[i]) depth[i] = 0;
        if (mask[i] && fromContour[i] <= SURVEY_REACH) {
          surveyed[i] = 1;
          surveyedCount += 1;
        }
      }
      relax(grid, depth, fixed, Math.min(600, 60 + Math.ceil(SURVEY_REACH / res) * 2));
      for (let i = 0; i < cells; i += 1) if (mask[i]) depth[i] = Math.max(0.3, depth[i]);
    }
  }
  let wet = 0;
  for (let i = 0; i < cells; i += 1) {
    if (!mask[i]) continue;
    wet += 1;
    if (depth[i] > maxDepth) maxDepth = depth[i];
  }
  return { area, grid, mask, surface, depth, surveyed, lakeLevel, maxDepth, surveyedShare: wet ? surveyedCount / wet : 0 };
}

/** Bilinear read of a per-cell model value at block (x, z), using only wet cells. */
function sample(model: Model, values: Float32Array, x: number, z: number): number {
  const { grid, mask } = model;
  const fx = (x - grid.x0) / grid.res - 0.5;
  const fz = (z - grid.z0) / grid.res - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fz);
  let sum = 0;
  let weight = 0;
  for (let dr = 0; dr <= 1; dr += 1) {
    for (let dc = 0; dc <= 1; dc += 1) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
      const i = r * grid.width + c;
      if (!mask[i]) continue;
      const w = (dc ? fx - c0 : 1 - (fx - c0)) * (dr ? fz - r0 : 1 - (fz - r0));
      sum += values[i] * w;
      weight += w;
    }
  }
  return weight > 1e-6 ? sum / weight : NaN;
}

/** The lake the depth survey covers: the one whose box holds the most contour vertices. */
function surveyedLake(areas: WaterArea[], contours: Contour[]): WaterArea | null {
  let best: WaterArea | null = null;
  let bestCount = 0;
  for (const area of areas) {
    if (area.kind !== "lake" || area.area < 1e6) continue;
    let count = 0;
    for (const contour of contours) {
      for (const part of contour.parts) {
        for (let i = 0; i < part.length; i += 20) {
          if (part[i] >= area.bbox.x0 && part[i] <= area.bbox.x1 && part[i + 1] >= area.bbox.z0 && part[i + 1] <= area.bbox.z1) count += 1;
        }
      }
    }
    if (count > bestCount) {
      best = area;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Meters to add to a contour's elevation to put it on the lidar's vertical datum. The lake was drawn down
 * when the lidar was flown, so the shallow contours lie on dry shore the lidar measured directly.
 */
function calibrateDatum(contours: Contour[], terrain: Terrain, lakeLevelM: number): number {
  const offsets: number[] = [];
  for (const contour of contours) {
    if (contour.elevationFeet < LAKE_POOL_FEET - 15) continue;
    const contourM = contour.elevationFeet * FEET;
    for (const part of contour.parts) {
      for (let i = 0; i < part.length; i += 6) {
        const value = terrain.at(part[i], part[i + 1]);
        if (value === NODATA) continue;
        const lidarM = value / 10;
        if (lidarM < lakeLevelM + 0.3 || Math.abs(lidarM - contourM) > 6) continue;
        offsets.push(lidarM - contourM);
      }
    }
  }
  if (offsets.length < 200) {
    console.log(`only ${offsets.length} dry contour samples; using the usual NGVD29 to NAVD88 offset`);
    return 1.1;
  }
  console.log(`datum from ${offsets.length} dry contour samples`);
  return median(offsets);
}

function overlaps(box: { x0: number; z0: number; x1: number; z1: number }, tx: number, tz: number) {
  return box.x1 >= tx * SIZE && box.x0 < (tx + 1) * SIZE && box.z1 >= tz * SIZE && box.z0 < (tz + 1) * SIZE;
}

async function main() {
  const started = Date.now();
  const terrain = new Terrain();
  const circleBox = { x0: -R, z0: -R, x1: R, z1: R };
  const { areas, lines } = loadOsmWater(path.join(SOURCES_DIR, "osm", "water.json"));
  const inCircle = (box: { x0: number; z0: number; x1: number; z1: number }) => box.x1 >= -R && box.x0 <= R && box.z1 >= -R && box.z0 <= R;
  const keptAreas = areas.filter((area) => inCircle(area.bbox)).sort((a, b) => b.area - a.area);
  const keptLines = lines.filter((line) => inCircle(line.bbox));
  console.log(`${keptAreas.length} water areas and ${keptLines.length} stream lines in the circle`);

  const contours = loadContours(path.join(SOURCES_DIR, "bathymetry", "bathymetry_cdabasin_cdatribe"), circleBox);
  console.log(`${contours.length} depth contours in the circle`);

  const lake = surveyedLake(keptAreas, contours);
  let contourShift: number | null = null;
  if (lake) {
    if (!lake.name) lake.name = "Coeur d'Alene Lake";
    const probe = buildModel(lake, terrain, [], null);
    if (probe?.lakeLevel) {
      contourShift = calibrateDatum(contours, terrain, probe.lakeLevel / 10);
      console.log(
        `${lake.name} surface in the lidar: ${(probe.lakeLevel / 10).toFixed(2)} m, ${(probe.lakeLevel / 10 / FEET - LAKE_POOL_FEET).toFixed(1)} ft from summer pool; contour datum offset ${contourShift.toFixed(2)} m`,
      );
    }
  }

  const models: Model[] = [];
  for (const area of keptAreas) {
    const model = buildModel(area, terrain, contours, contourShift);
    if (model) models.push(model);
  }
  console.log(`modelled ${models.length} areas in ${((Date.now() - started) / 1000).toFixed(0)} s`);

  await rm(path.join(WORLD_DIR, "water"), { recursive: true, force: true });
  await mkdir(path.join(WORLD_DIR, "water"), { recursive: true });

  const tiles = worldTiles();
  let written = 0;
  let wetBlocks = 0;
  for (const { tx, tz } of tiles) {
    const tileModels = models.filter((model) => overlaps(model.area.bbox, tx, tz));
    const tileLines = keptLines.filter((line) => overlaps({ x0: line.bbox.x0 - 20, z0: line.bbox.z0 - 20, x1: line.bbox.x1 + 20, z1: line.bbox.z1 + 20 }, tx, tz));
    if (tileModels.length === 0 && tileLines.length === 0) continue;
    const ground = terrain.tile(tx, tz);
    if (!ground) continue;
    const surface = new Int16Array(SIZE * SIZE).fill(NODATA);
    const bed = new Int16Array(SIZE * SIZE).fill(NODATA);
    const flags = new Int16Array(SIZE * SIZE);
    const grid: Grid = { x0: tx * SIZE, z0: tz * SIZE, res: 1, width: SIZE, height: SIZE };

    for (const model of [...tileModels].reverse()) {
      const kind = model.area.kind === "lake" ? FLAG_LAKE : FLAG_RIVER;
      fillRings(grid, model.area.rings, (i) => {
        const x = grid.x0 + (i % SIZE) + 0.5;
        const z = grid.z0 + Math.floor(i / SIZE) + 0.5;
        const level = model.lakeLevel ?? sample(model, model.surface, x, z);
        if (Number.isNaN(level) || ground[i] === NODATA || ground[i] > level + 20) return;
        let below = sample(model, model.depth, x, z);
        if (Number.isNaN(below)) below = 0.4;
        surface[i] = Math.round(level);
        bed[i] = Math.min(ground[i], Math.round(level - below * 10));
        flags[i] = kind | (sample(model, model.surveyed, x, z) >= 0.5 ? FLAG_SURVEYED : 0);
      });
    }

    for (const line of tileLines) {
      const reach = Math.max(0.5, line.width / 2);
      const look = Math.ceil(reach) + 2;
      strokeLine(grid, line.points, reach, (i) => {
        if (surface[i] !== NODATA) return;
        const col = i % SIZE;
        const row = Math.floor(i / SIZE);
        let low = Infinity;
        for (let dz = -look; dz <= look; dz += 1) {
          for (let dx = -look; dx <= look; dx += 1) {
            const c = col + dx;
            const r = row + dz;
            if (c < 0 || r < 0 || c >= SIZE || r >= SIZE) continue;
            const value = ground[r * SIZE + c];
            if (value !== NODATA && value < low) low = value;
          }
        }
        if (!Number.isFinite(low)) return;
        surface[i] = low - 3;
        bed[i] = Math.round(low - 3 - line.depth * 10);
        flags[i] = FLAG_STREAM;
      });
    }

    let wet = 0;
    for (let i = 0; i < surface.length; i += 1) if (surface[i] !== NODATA) wet += 1;
    if (wet === 0) continue;
    wetBlocks += wet;
    await writeTile("water", 0, tx, tz, [surface, bed, flags]);
    written += 1;
  }

  const features = models
    .filter((model) => model.area.area > 2000 || model.area.name)
    .map((model) => ({
      id: model.area.id,
      name: model.area.name,
      kind: model.area.kind,
      areaM2: Math.round(model.area.area),
      surfaceM: model.lakeLevel === null ? null : Math.round(model.lakeLevel) / 10,
      maxDepthM: Math.round(model.maxDepth * 10) / 10,
      surveyedShare: Math.round(model.surveyedShare * 100) / 100,
      cell: model.grid.res,
    }));
  await writeFile(path.join(WORLD_DIR, "water", "features.json"), JSON.stringify({ contourShift, features }, null, 1));
  console.log(`wrote ${written} water tiles, ${(wetBlocks / 1e6).toFixed(1)} million wet blocks, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  for (const feature of features.filter((entry) => entry.name).slice(0, 25)) {
    console.log(
      `  ${feature.name} (${feature.kind}): ${(feature.areaM2 / 1e6).toFixed(2)} km², surface ${feature.surfaceM ?? "follows river"} m, deepest ${feature.maxDepthM} m, ${Math.round(feature.surveyedShare * 100)}% surveyed`,
    );
  }
}

await main();
