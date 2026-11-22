/**
 * Zoom pyramid for the map. Level 0 joins the layers at one block per sample: the ground (lake and river
 * beds under water), the water surface (NODATA when dry), and the water flags. Each higher level halves
 * the resolution, so a level L tile covers tileSize << L blocks.
 *
 *   node --import tsx scripts/inw/build-view.ts [--jobs 8]
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { NODATA, WORLD, worldTiles } from "../../src/lib/inw/grid.ts";
import { WORLD_DIR, readTile, writeTile } from "../../src/lib/inw/store.ts";

const SIZE = WORLD.tileSize;
const HALF = SIZE / 2;
const args = process.argv.slice(2);
const jobs = Number(args[args.indexOf("--jobs") + 1]) || 8;
const shardArg = args.includes("--shard") ? args[args.indexOf("--shard") + 1] : null;
const levelArg = args.includes("--level") ? Number(args[args.indexOf("--level") + 1]) : null;

function tilesAt(level: number): { tx: number; tz: number }[] {
  if (level === 0) return worldTiles();
  const seen = new Map<string, { tx: number; tz: number }>();
  for (const { tx, tz } of tilesAt(level - 1)) {
    const parent = { tx: Math.floor(tx / 2), tz: Math.floor(tz / 2) };
    seen.set(`${parent.tx},${parent.tz}`, parent);
  }
  return [...seen.values()];
}

async function baseTile(tx: number, tz: number) {
  const terrain = await readTile("terrain", 0, tx, tz, 1);
  if (!terrain) return;
  const ground = terrain[0];
  const surface = new Int16Array(SIZE * SIZE).fill(NODATA);
  const flags = new Int16Array(SIZE * SIZE);
  const water = await readTile("water", 0, tx, tz, 3);
  if (water) {
    const [level, bed, kinds] = water;
    for (let i = 0; i < ground.length; i += 1) {
      if (level[i] === NODATA) continue;
      surface[i] = level[i];
      ground[i] = bed[i];
      flags[i] = kinds[i];
    }
  }
  await writeTile("view", 0, tx, tz, [ground, surface, flags]);
}

async function parentTile(level: number, tx: number, tz: number) {
  const ground = new Int16Array(SIZE * SIZE).fill(NODATA);
  const surface = new Int16Array(SIZE * SIZE).fill(NODATA);
  const flags = new Int16Array(SIZE * SIZE);
  let any = false;
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const qx = quadrant & 1;
    const qz = quadrant >> 1;
    const child = await readTile("view", level - 1, tx * 2 + qx, tz * 2 + qz, 3);
    if (!child) continue;
    any = true;
    const [childGround, childSurface, childFlags] = child;
    for (let z = 0; z < HALF; z += 1) {
      for (let x = 0; x < HALF; x += 1) {
        let groundSum = 0;
        let groundCount = 0;
        let wetSum = 0;
        let wetCount = 0;
        let flag = 0;
        for (let k = 0; k < 4; k += 1) {
          const i = (z * 2 + (k >> 1)) * SIZE + x * 2 + (k & 1);
          if (childGround[i] !== NODATA) {
            groundSum += childGround[i];
            groundCount += 1;
          }
          if (childSurface[i] !== NODATA) {
            wetSum += childSurface[i];
            wetCount += 1;
            flag = Math.max(flag, childFlags[i]);
          }
        }
        const out = (qz * HALF + z) * SIZE + qx * HALF + x;
        if (groundCount > 0) ground[out] = Math.round(groundSum / groundCount);
        if (wetCount >= 2) {
          surface[out] = Math.round(wetSum / wetCount);
          flags[out] = flag;
        }
      }
    }
  }
  if (any) await writeTile("view", level, tx, tz, [ground, surface, flags]);
}

async function runShard(level: number, index: number, count: number) {
  const tiles = tilesAt(level).filter((_, i) => i % count === index);
  for (const { tx, tz } of tiles) {
    if (level === 0) await baseTile(tx, tz);
    else await parentTile(level, tx, tz);
  }
}

async function main() {
  if (shardArg && levelArg !== null) {
    const [index, count] = shardArg.split("/").map(Number);
    await runShard(levelArg, index, count);
    return;
  }
  const started = Date.now();
  await rm(path.join(WORLD_DIR, "view"), { recursive: true, force: true });
  for (let level = 0; level < WORLD.levels; level += 1) {
    const count = tilesAt(level).length;
    const workers = Math.min(jobs, count);
    await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, ["--import", "tsx", process.argv[1], "--level", String(level), "--shard", `${index}/${workers}`], {
            stdio: "inherit",
          });
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`level ${level} shard ${index} exited ${code}`))));
        }),
      ),
    );
    console.log(`level ${level}: ${count} tiles, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
}

await main();
