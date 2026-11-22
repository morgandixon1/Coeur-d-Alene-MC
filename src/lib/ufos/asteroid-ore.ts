import { Block as B, type BlockId } from "@/lib/blocks";
import { seededRandom } from "@/lib/seeded-random";
import type { Voxel, VoxelPosition } from "@/lib/voxels";
import { voxelKey } from "./scene";

const STONE = new Set<BlockId>([B.Stone, B.Basalt, B.Cobblestone]);
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const VEINS = [
  { block: B.IronOre, count: 9, min: 3, max: 6 },
  { block: B.CopperOre, count: 8, min: 3, max: 6 },
  { block: B.GoldOre, count: 4, min: 2, max: 3 },
  { block: B.DiamondOre, count: 3, min: 1, max: 2 },
  { block: B.EmeraldOre, count: 3, min: 1, max: 2 },
] as const;

const keyOf = ({ x, y, z }: VoxelPosition) => voxelKey(x, y, z);
const neighbors = ({ x, y, z }: VoxelPosition) =>
  SIDES.map(([dx, dy, dz]) => ({ x: x + dx, y: y + dy, z: z + dz }));
const distance = (a: VoxelPosition, b: VoxelPosition) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

export function addAsteroidOre(
  blocks: Map<string, Voxel>,
  rock: ReadonlyMap<string, Voxel>,
  floors: ReadonlyMap<string, unknown>,
  caveAir: ReadonlySet<string>,
  rx: number,
  rz: number,
  seed: number,
) {
  const random = seededRandom(seed ^ 0xb7028c3a);
  const pick = <T>(pool: readonly T[]) => pool[Math.floor(random() * pool.length)];
  const available = new Set<string>();
  const stone: Voxel[] = [];
  for (const [key, voxel] of rock) {
    const { x, z } = voxel;
    if (!STONE.has(voxel.block) || blocks.get(key) !== voxel || floors.has(key) || Math.hypot(x / rx, z / rz) > 0.89) continue;
    stone.push(voxel);
    available.add(key);
  }
  const caveStone = stone.filter((voxel) => neighbors(voxel).some((point) => caveAir.has(keyOf(point))));

  function grow(start: VoxelPosition, count: number, within: (point: VoxelPosition) => boolean) {
    const vein = [start];
    const seen = new Set([keyOf(start)]);
    const frontier: VoxelPosition[] = [];
    const addNeighbors = (point: VoxelPosition) => {
      for (const adjacent of neighbors(point)) {
        const key = keyOf(adjacent);
        if (seen.has(key) || !available.has(key) || !within(adjacent)) continue;
        seen.add(key);
        frontier.push(adjacent);
      }
    };
    addNeighbors(start);
    while (vein.length < count && frontier.length) {
      const index = Math.floor(random() * frontier.length);
      const [next] = frontier.splice(index, 1);
      vein.push(next);
      addNeighbors(next);
    }
    return vein;
  }

  const place = (positions: readonly VoxelPosition[], block: BlockId) => {
    for (const point of positions) {
      const key = keyOf(point);
      blocks.set(key, { ...point, block });
      available.delete(key);
    }
  };

  const central = ({ x, y, z }: VoxelPosition) => Math.abs(x) <= 8 && Math.abs(z) <= 8 && y >= -9 && y <= 8;
  let cluster: VoxelPosition[] = [];
  for (const pool of [caveStone, stone]) {
    const starts = pool.filter(central);
    const offset = Math.floor(random() * starts.length);
    for (let i = 0; i < starts.length; i++) {
      const vein = grow(starts[(i + offset) % starts.length], 3, central);
      if (vein.length !== 3) continue;
      cluster = vein;
      break;
    }
    if (cluster.length) break;
  }
  place(cluster, B.AncientDebris);

  function choose(pool: readonly Voxel[], allowed: (position: Voxel) => boolean) {
    if (!pool.length) return;
    for (let i = 0; i < 24; i++) {
      const point = pick(pool);
      if (available.has(keyOf(point)) && allowed(point)) return point;
    }
    return pick(pool.filter((point) => available.has(keyOf(point)) && allowed(point)));
  }

  const debris = [...cluster];
  const scatteredCount = 5 + Math.floor(random() * 6);
  for (let i = 0; i < scatteredCount; i++) {
    const point = choose(stone, (candidate) =>
      !central(candidate) && debris.every((other) => distance(candidate, other) >= 5));
    if (!point) break;
    place([point], B.AncientDebris);
    debris.push(point);
  }

  for (const { block, count, min, max } of VEINS) {
    const within = ({ y }: VoxelPosition) => block === B.DiamondOre || block === B.EmeraldOre ? y <= 2 : true;
    for (let i = 0; i < count; i++) {
      const start = choose(i % 3 === 2 ? stone : caveStone, within);
      if (start) place(grow(start, min + Math.floor(random() * (max - min + 1)), within), block);
    }
  }
}
