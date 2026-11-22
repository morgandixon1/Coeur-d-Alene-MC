/**
 * Convert a rectangle of the height map into a Bedrock .mcworld.
 *
 *   node --import tsx scripts/inw/build-mcworld.ts --center 0,0 --size 512
 *   node --import tsx scripts/inw/build-mcworld.ts --x -256 --z -256 --size 512 --name "Downtown"
 *
 * Size is metres on a side (one metre = one block) and is rounded up to a multiple of 16.
 * Writes data/world/exports/<name>-<x>_<z>-<size>.mcworld
 */
import { writeRegionMcworld } from "../../src/lib/inw/region-world.ts";

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] ?? null : null;
}

const size = Number(flag("--size") ?? 512);
const name = flag("--name") ?? undefined;
let x0: number;
let z0: number;
const center = flag("--center");
if (center) {
  const [cx, cz] = center.split(",").map(Number);
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) throw new Error("--center wants x,z");
  x0 = Math.floor(cx - size / 2);
  z0 = Math.floor(cz - size / 2);
} else {
  x0 = Number(flag("--x") ?? 0);
  z0 = Number(flag("--z") ?? 0);
}

const started = Date.now();
const result = await writeRegionMcworld({ x0, z0, size, name }, (progress) => {
  if (progress.chunksDone % 64 !== 0 && progress.chunksDone !== progress.chunksTotal) return;
  const pct = ((100 * progress.chunksDone) / progress.chunksTotal).toFixed(0);
  process.stdout.write(`\r${pct}%  ${progress.columns} columns  ${progress.wet} wet`);
});
process.stdout.write("\n");
console.log(
  `wrote ${result.path} (${(result.bytes / 1e6).toFixed(1)} MB, spawn ${result.spawn.x},${result.spawn.y},${result.spawn.z}) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
