/**
 * Terrain layer: bare-earth lidar elevation, one sample per block, in decimeters.
 * Writes data/world/terrain/0/<tx>_<tz>.bin. Rerunning skips tiles that exist unless --force.
 *
 *   node --import tsx scripts/inw/build-terrain.ts [--force] [--jobs 8]
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NODATA, ORIGIN, WORLD, worldTiles } from "../../src/lib/inw/grid.ts";
import { SOURCES_DIR, WORLD_DIR, tileFile, writeTile } from "../../src/lib/inw/store.ts";
import { PROJECT_ORDER } from "./lidar-order.ts";

type Raw = { name: string; project: string; west: number; north: number; width: number; height: number; fd: number };

const SIZE = WORLD.tileSize;
const args = process.argv.slice(2);
const force = args.includes("--force");
const shardArg = args.includes("--shard") ? args[args.indexOf("--shard") + 1] : null;
const jobs = Number(args[args.indexOf("--jobs") + 1]) || 8;

function openRaws(): Raw[] {
  const listing = JSON.parse(readFileSync(path.join(SOURCES_DIR, "lidar-files.json"), "utf8")) as { project: string; file: string }[];
  const raws: Raw[] = [];
  for (const entry of listing) {
    const base = entry.file.replace(/\.tif$/, "");
    const metaPath = path.join(SOURCES_DIR, "lidar-raw", `${base}.json`);
    if (!existsSync(metaPath)) throw new Error(`Missing ${base}; run scripts/inw/lidar-to-raw.py first.`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { west: number; north: number; width: number; height: number };
    raws.push({ name: base, project: entry.project, ...meta, fd: openSync(path.join(SOURCES_DIR, "lidar-raw", `${base}.i16`), "r") });
  }
  return raws.sort((a, b) => PROJECT_ORDER.indexOf(a.project) - PROJECT_ORDER.indexOf(b.project));
}

/** Spreads valid neighbors into small holes. Larger gaps stay NODATA and show up in the stats. */
function fillHoles(cells: Int16Array): number {
  let holes = 0;
  for (let i = 0; i < cells.length; i += 1) if (cells[i] === NODATA) holes += 1;
  if (holes === 0 || holes === cells.length) return holes;
  for (let pass = 0; pass < 48 && holes > 0; pass += 1) {
    const next = cells.slice();
    for (let z = 0; z < SIZE; z += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const i = z * SIZE + x;
        if (cells[i] !== NODATA) continue;
        let sum = 0;
        let count = 0;
        const take = (j: number) => {
          if (cells[j] === NODATA) return;
          sum += cells[j];
          count += 1;
        };
        if (x > 0) take(i - 1);
        if (x < SIZE - 1) take(i + 1);
        if (z > 0) take(i - SIZE);
        if (z < SIZE - 1) take(i + SIZE);
        if (count > 0) {
          next[i] = Math.round(sum / count);
          holes -= 1;
        }
      }
    }
    cells.set(next);
  }
  return holes;
}

async function buildShard(index: number, count: number) {
  const raws = openRaws();
  const row = Buffer.alloc(SIZE * 2);
  const rowValues = new Int16Array(row.buffer, row.byteOffset, SIZE);
  const stats: { tx: number; tz: number; min: number; max: number; holes: number }[] = [];
  const tiles = worldTiles().filter((_, i) => i % count === index);
  for (const { tx, tz } of tiles) {
    if (!force && existsSync(tileFile("terrain", 0, tx, tz))) continue;
    const cells = new Int16Array(SIZE * SIZE).fill(NODATA);
    const east0 = ORIGIN.e + tx * SIZE;
    for (const raw of raws) {
      const col0 = Math.max(0, east0 - raw.west);
      const col1 = Math.min(raw.width, east0 + SIZE - raw.west);
      if (col1 <= col0) continue;
      for (let z = 0; z < SIZE; z += 1) {
        const r = raw.north - ORIGIN.n + tz * SIZE + z;
        if (r < 0 || r >= raw.height) continue;
        const span = col1 - col0;
        readSync(raw.fd, row, 0, span * 2, (r * raw.width + col0) * 2);
        const base = z * SIZE + (raw.west + col0 - east0);
        for (let c = 0; c < span; c += 1) {
          if (cells[base + c] !== NODATA) continue;
          const value = rowValues[c];
          if (value !== NODATA) cells[base + c] = value;
        }
      }
    }
    const holes = fillHoles(cells);
    let min = 32767;
    let max = -32768;
    for (const value of cells) {
      if (value === NODATA) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    await writeTile("terrain", 0, tx, tz, [cells]);
    stats.push({ tx, tz, min, max, holes });
  }
  for (const raw of raws) closeSync(raw.fd);
  await writeFile(path.join(WORLD_DIR, "terrain", `stats-${index}.json`), JSON.stringify(stats));
}

async function main() {
  if (shardArg) {
    const [index, count] = shardArg.split("/").map(Number);
    await buildShard(index, count);
    return;
  }
  const started = Date.now();
  console.log(`${worldTiles().length} tiles, ${jobs} jobs`);
  await Promise.all(
    Array.from({ length: jobs }, (_, index) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", process.argv[1], "--shard", `${index}/${jobs}`, ...(force ? ["--force"] : [])], {
          stdio: "inherit",
        });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${index} exited ${code}`))));
      }),
    ),
  );
  const all: { tx: number; tz: number; min: number; max: number; holes: number }[] = [];
  for (let index = 0; index < jobs; index += 1) {
    const file = path.join(WORLD_DIR, "terrain", `stats-${index}.json`);
    if (existsSync(file)) all.push(...JSON.parse(readFileSync(file, "utf8")));
  }
  const filled = all.filter((tile) => tile.min <= tile.max);
  const min = Math.min(...filled.map((tile) => tile.min)) / 10;
  const max = Math.max(...filled.map((tile) => tile.max)) / 10;
  const holes = all.reduce((sum, tile) => sum + tile.holes, 0);
  console.log(`built ${all.length} tiles in ${((Date.now() - started) / 1000).toFixed(0)} s; elevation ${min}..${max} m; ${holes} cells still empty`);
}

await main();
