import { Block as B } from "@/lib/blocks";
import { seededRandom } from "@/lib/seeded-random";
import type { Voxel, VoxelPosition } from "@/lib/voxels";
import type { UfoCivilization, UfoCondition } from "./catalog";
import { voxelKey, type Ufo } from "./scene";

type SalvageRoom = { name: string; entry: VoxelPosition; positions: VoxelPosition[] };
type Loot = readonly [item: string, max: number];

const SUPPLIES: readonly Loot[] = [["torch", 5], ["bread", 3], ["baked_potato", 3], ["charcoal", 4]];
const SALVAGE = {
  classic: [["copper_ingot", 4], ["iron_ingot", 2], ["string", 4], ["glass_pane", 5]],
  xenos: [["bone", 4], ["copper_ingot", 4], ["string", 4], ["quartz", 3]],
  blight: [["flint", 4], ["bone", 4], ["clay_ball", 5], ["amethyst_shard", 2]],
} as const satisfies Record<UfoCivilization, readonly Loot[]>;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function addSalvage(
  cells: Map<string, Voxel>,
  rooms: readonly SalvageRoom[],
  { civilization, condition, seed, area }: { civilization: UfoCivilization; condition: UfoCondition; seed: number; area: number },
): Ufo["chests"] {
  const random = seededRandom(seed ^ 0x51e67c0d);
  // Area changes the number of caches. Every size uses the same small loot tables.
  const limit = Math.min(9, 2 + Math.floor(area / 175));
  const chests: Ufo["chests"] = [];
  const open = (x: number, y: number, z: number) => (cells.get(voxelKey(x, y, z))?.block ?? B.Air) === B.Air;
  const standing = (x: number, y: number, z: number) => !open(x, y - 1, z) && open(x, y, z) && open(x, y + 1, z);
  const awayFromEntry = ({ x, y, z }: VoxelPosition) => rooms.every(({ entry }) =>
    entry.y !== y || Math.abs(entry.x - x) + Math.abs(entry.z - z) >= 2);
  const roll = (pool: readonly Loot[]) => {
    const [item, max] = pool[Math.floor(random() * pool.length)];
    return { name: `minecraft:${item}`, count: 1 + Math.floor(random() * max) };
  };

  for (const room of shuffle(rooms, random)) {
    if (chests.length >= limit) break;
    const spot = shuffle(room.positions, random).find(({ x, y, z }) =>
      standing(x, y, z) && awayFromEntry({ x, y, z }) &&
      SIDES.filter(([dx, dz]) => standing(x + dx, y, z + dz)).length >= 3 &&
      chests.every((placed) => placed.y !== y || Math.abs(placed.x - x) + Math.abs(placed.z - z) >= 4));
    if (!spot) continue;

    const { x, y, z } = spot;
    const trapped = condition !== "landed" && chests.length === 0;
    cells.set(voxelKey(x, y, z), { x, y, z, block: trapped ? B.TrappedChest : B.Chest });
    if (trapped) cells.set(voxelKey(x, y - 1, z), { x, y: y - 1, z, block: B.Tnt });
    chests.push({ ...spot, label: room.name, items: [roll(SUPPLIES), roll(SALVAGE[civilization])] });
  }
  return chests;
}
