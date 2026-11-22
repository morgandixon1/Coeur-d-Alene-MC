import { Block, type BlockId } from "@/lib/blocks";

/**
 * Base ground, no trees. The mix under 1,100 m is dirt, gravel, and sand in the
 * proportion that averages to the dry meadow in the reference photo (about 145, 131, 107).
 * Higher bands are the forest floor, rock, and snow.
 */
export function groundCover(x: number, z: number, meters: number): BlockId {
  const pick = mix(x, z);
  if (meters >= 1550) return pick < 0.82 ? Block.Snow : Block.Stone;
  if (meters >= 1350) return pick < 0.78 ? Block.Stone : Block.Gravel;
  if (meters >= 1100) {
    if (pick < 0.7) return Block.Podzol;
    if (pick < 0.88) return Block.Dirt;
    return Block.CoarseDirt;
  }
  if (pick < 0.32) return Block.Dirt;
  if (pick < 0.86) return Block.Gravel;
  return Block.Sand;
}

function mix(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967296;
}
