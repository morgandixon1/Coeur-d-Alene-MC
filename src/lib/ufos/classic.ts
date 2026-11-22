import { Block as B, type BlockId } from "@/lib/blocks";
import type { ClassicHull } from "./catalog";
type SetVoxel = (x: number, y: number, z: number, block: BlockId) => void;
type WithinHull = (x: number, z: number, radius: number) => boolean;
type Paint = (x1: number, z1: number, x2: number, z2: number, y: number, block: BlockId) => void;

export const CLASSIC_HULLS = {
  saucer: { rx: 15, rz: 15, power: 2, hull: B.Iron, trim: B.CyanConcrete },
  scout: { rx: 13, rz: 20, power: 2, hull: B.LightGrayConcrete, trim: B.PurpleConcrete },
  carrier: { rx: 20, rz: 16, power: 2.8, hull: B.Iron, trim: B.Copper },
} satisfies Record<ClassicHull, { rx: number; rz: number; power: number; hull: BlockId; trim: BlockId }>;

// Each pair is the hull radius at the corresponding height relative to the deck.
const SLICES = [
  [-3, 0.29], [-2, 0.55], [-1, 0.83], [0, 1], [1, 0.97],
  [2, 0.84], [3, 0.82], [4, 0.80], [5, 0.77], [6, 0.74], [7, 0.71],
  [8, 0.69], [9, 0.67], [10, 0.64], [11, 0.56], [12, 0.45], [13, 0.32], [14, 0.20],
] as const;

export function buildClassicHull(
  hull: ClassicHull, rx: number, rz: number, within: WithinHull, set: SetVoxel, lights: BlockId,
) {
  const profile = CLASSIC_HULLS[hull];
  for (const [i, [y, radius]] of SLICES.entries()) {
    for (let x = -rx; x <= rx; x++) {
      for (let z = -rz; z <= rz; z++) {
        if (!within(x, z, radius)) continue;
        const edge = !within(x + 1, z, radius) || !within(x - 1, z, radius)
          || !within(x, z + 1, radius) || !within(x, z - 1, radius);
        const cap = !within(x, z, SLICES[i + (y < 0 ? -1 : 1)]?.[1] ?? 0);
        if (y > 1 && !edge && !cap) continue;
        if (y < 0 && !edge && !cap && y !== -3) continue;
        if (y === 1 && within(x, z, 0.77) && !edge) continue;

        let block: BlockId = profile.hull;
        if (y < 0) block = y === -3 && (x + z) % 2 === 0 ? lights : B.GrayConcrete;
        if (y === 0) block = edge ? B.GrayConcrete : within(x, z, 0.74) ? B.GrayConcrete : profile.hull;
        if (y === 1 && !within(x, z, 0.87)) block = (Math.round(Math.atan2(z, x) * 12) % 3 === 0) ? lights : profile.trim;
        if (y === 1 && within(x, z, 0.87)) block = profile.hull;
        if ((y === 3 || y === 4) && edge && (z <= 1 || Math.abs(x) > rx * 0.55)) block = B.Glass;
        if (y === 13) block = hull === "carrier" ? profile.trim : B.Glass;
        if (y === 14 && Math.abs(x) + Math.abs(z) < 3) block = lights;
        set(x, y, z, block);
      }
    }
  }
}

export function addClassicLandingGear(rx: number, rz: number, set: SetVoxel, paint: Paint) {
  for (const [footX, footZ] of [[-Math.round(rx * 0.58), 2], [Math.round(rx * 0.58), 2], [0, -Math.round(rz * 0.65)]]) {
    paint(footX - 1, footZ - 1, footX + 1, footZ + 1, -4, B.GrayConcrete);
    for (let y = -3; y <= -1; y++) set(footX, y, footZ, B.Iron);
  }
}
