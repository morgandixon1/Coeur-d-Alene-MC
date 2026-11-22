import { Block as B, type BlockId } from "@/lib/blocks";
import type { XenosHull } from "./catalog";

export const XENOS_HULLS = {
  shrike: { rx: 17, rz: 24, widthExtension: 6, noseExtension: 0, hull: B.BlackConcrete, trim: B.RedConcrete },
  broodArk: { rx: 19, rz: 23, widthExtension: 2, noseExtension: 0, hull: B.Obsidian, trim: B.PurpleConcrete },
  maw: { rx: 22, rz: 20, widthExtension: 0, noseExtension: 5, hull: B.Obsidian, trim: B.RedTerracotta },
} as const;

export function withinXenosHull(hull: XenosHull, x: number, z: number, rx: number, rz: number, radius: number) {
  const length = z / rz;
  const width = hull === "shrike" ? 0.89 + 0.24 * length
    : hull === "broodArk" ? 0.91 + 0.09 * Math.cos(length * 3 * Math.PI)
    : 1 - 0.29 * length;
  const taper = hull === "maw" && length < 0 ? length * 1.24 : length;
  return (x / (rx * width)) ** 2 + Math.abs(taper) ** (hull === "broodArk" ? 3 : 2) <= radius ** 2;
}

const SLICES = [
  [-3, 0.34], [-2, 0.52], [-1, 0.69], [0, 0.92],
  [1, 0.89], [2, 0.85], [3, 0.83], [4, 0.81], [5, 0.78],
  [6, 0.75], [7, 0.73], [8, 0.70], [9, 0.67], [10, 0.64],
  [11, 0.59], [12, 0.52], [13, 0.43], [14, 0.32], [15, 0.23],
] as const;

type SetVoxel = (x: number, y: number, z: number, block: BlockId) => void;
type WithinHull = (x: number, z: number, radius: number) => boolean;

export function buildXenosHull(
  hull: XenosHull, rx: number, rz: number, within: WithinHull, set: SetVoxel, landed: boolean,
) {
  const profile = XENOS_HULLS[hull];
  const ribSpacing = hull === "broodArk" ? 5 : 4;
  const ribOffset = hull === "maw" ? 1 : 0;
  for (const [i, [y, radius]] of SLICES.entries()) {
    for (let x = -rx; x <= rx; x++) {
      for (let z = -rz; z <= rz; z++) {
        if (!within(x, z, radius)) continue;
        const edge = !within(x + 1, z, radius) || !within(x - 1, z, radius)
          || !within(x, z + 1, radius) || !within(x, z - 1, radius);
        const cap = !within(x, z, SLICES[i + (y < 0 ? -1 : 1)]?.[1] ?? 0);
        if (y !== 0 && !edge && !cap) continue;

        const rib = (z + ribOffset) % ribSpacing === 0;
        let block: BlockId = profile.hull;
        if (y === 0) block = within(x, z, 0.73) ? B.RedTerracotta : profile.hull;
        if (y > 0 && rib) block = y === 4 && edge ? B.Shroomlight : B.Basalt;
        if (y > 0 && !rib && (y === 2 || y === 5) && edge && Math.abs(x) > 3) block = profile.trim;
        if (y >= 6 && Math.abs(x) <= 1 && cap) block = rib ? B.Shroomlight : profile.trim;
        set(x, y, z, block);
        if (y >= 4 && cap && rib && Math.abs(x) >= 2) {
          set(x, y + 1, z, Math.abs(x) >= rx * 0.30 && Math.abs(x) <= rx * 0.48 ? B.Quartz : B.Basalt);
        }
      }
    }
  }

  for (const side of [-1, 1]) {
    if (hull === "shrike") {
      // Scythe wings sweep aft, with bony tips growing out of the armored flanks.
      for (let offset = 0; offset <= rx + profile.widthExtension - 5; offset++) {
        const x = (5 + offset) * side;
        const start = -8 + Math.floor(offset * 0.87);
        const chord = Math.max(1, 10 - Math.floor(offset * 0.44));
        const y = Math.floor(offset / 6);
        for (let z = start; z < start + chord; z++) {
          set(x, y, z, chord === 1 ? B.Quartz : z === start ? B.Basalt : profile.hull);
          if (chord >= 4) set(x, y - 1, z, z === start + chord - 1 ? B.RedConcrete : B.Obsidian);
        }
      }
    } else if (hull === "broodArk") {
      // Three lobes per flank give the ark a segmented abdomen.
      for (const centerZ of [-9, 0, 9]) {
        for (let x = rx - 8; x <= rx + profile.widthExtension; x++) {
          for (let dz = -4; dz <= 4; dz++) {
            for (let y = -1; y <= 6; y++) {
              if (((x - rx + 4) / 6) ** 2 + (dz / 4.5) ** 2 + ((y - 2) / 4.3) ** 2 > 1) continue;
              const block = y === 3 && Math.abs(dz) <= 1 ? B.CryingObsidian : dz === 0 ? B.Basalt : profile.hull;
              set(x * side, y, centerZ + dz, block);
            }
          }
        }
      }
    } else {
      // Two armored mandibles frame a dark cleft at the nose.
      const jawLength = rz + profile.noseExtension - 6;
      for (let offset = 0; offset <= jawLength; offset++) {
        const z = -6 - offset;
        const t = offset / jawLength;
        const center = Math.round(rx * (0.55 - t * 0.2));
        const spread = Math.ceil(4 * (1 - t));
        const height = Math.ceil(6 * (1 - t));
        for (let dx = -spread; dx <= spread; dx++) {
          for (let y = -1; y <= height; y++) {
            set((center + dx) * side, y + Math.floor(t * 3), z,
              t > 0.82 ? B.Quartz : dx === -spread ? B.RedConcrete : y === height ? B.Basalt : profile.hull);
          }
        }
      }
    }

    if (landed) {
      for (const z of [-Math.round(rz * 0.35), Math.round(rz * 0.35)]) {
        const x = Math.round(rx * 0.49);
        for (let y = -4; y < 0; y++) set((x + Math.floor(-y / 2)) * side, y, z, y === -4 ? B.Quartz : profile.hull);
        set((x + 2) * side, -4, z + 1, B.Quartz);
      }
    }
  }
}
