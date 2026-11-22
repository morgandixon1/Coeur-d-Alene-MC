import { Block as B, type BlockId } from "@/lib/blocks";
import type { AsteroidHull, UfoCondition } from "./catalog";

type Site = {
  hull: AsteroidHull;
  condition: UfoCondition;
  rx: number;
  rz: number;
  height: number;
  lobes: number;
  phase: number;
  outerY: number;
};

const STONE = [B.Basalt, B.Stone, B.Cobblestone, B.Basalt, B.Stone] as const;
const WEATHERED = [B.BrownTerracotta, B.Sandstone, B.BrownTerracotta, B.Cobblestone] as const;

// The radius is measured along the rock surface in blocks. Directions are tilted so
// bowls on the shoulder cut into the sides instead of dropping straight down.
const SURFACE_IMPACTS = [
  [0.43, 0.77, 0.46, 8.3, 7.0],
  [-0.55, 0.81, 0.25, 5.5, 4.3],
  [0.35, 0.83, -0.43, 6.0, 4.4],
  [0.72, 0.40, -0.45, 4.2, 2.5],
  [-0.34, 0.53, -0.78, 4.0, 2.6],
] as const;

export function asteroidGeology(site: Site, noise: (x: number, y: number, z: number) => number) {
  const { hull, condition, rx, rz, height, lobes, phase, outerY } = site;
  const shattered = condition === "exploded";
  const size = (rx + rz + height) / 3;
  const impacts = SURFACE_IMPACTS.map(([x, y, z, radius, depth], index) => {
    const length = Math.hypot(x, y, z);
    const turn = (noise(index, 0, 91) - 0.5) * 0.34;
    return {
      x: (x * Math.cos(turn) - z * Math.sin(turn)) / length,
      y: y / length,
      z: (z * Math.cos(turn) + x * Math.sin(turn)) / length,
      radius: radius / size * (0.88 + noise(index, 4, 31) * 0.24),
      depth: depth / size,
    };
  });

  const groundImpacts = [
    { x: rx + 12, z: rz * 0.61, radius: 7, depth: 4 },
    { x: -rx - 10, z: rz * 0.36, radius: 6, depth: 3 },
    { x: rx * 0.52, z: -rz - 11, radius: 8, depth: 5 },
    { x: -rx * 0.72, z: -rz - 8, radius: 5, depth: 3 },
    { x: rx * 0.44, z: rz + 14, radius: 5, depth: 3 },
  ].map((impact, i) => ({
    ...impact,
    x: impact.x + Math.round(noise(i, 4, 11) * 4 - 2),
    z: impact.z + Math.round(noise(i, 5, 11) * 4 - 2),
  }));

  function groundAt(x: number, z: number) {
    const r = Math.hypot((x - (shattered ? 3 : 0)) / (rx + 11), (z - (condition === "skid" ? 6 : 0)) / (rz + 11));
    let depth = Math.max(0, 1 - r * r) * (condition === "landed" ? 3 : condition === "impact" ? 10 : 6);
    let rim = Math.max(0, 1 - Math.abs(r - 0.99) * 10) * (condition === "impact" ? 3.8 : 1.6);
    let disturbed = r < 1.08;
    if (condition === "skid") {
      const progress = (z + rz + 35) / (rz + 29);
      if (progress > 0 && progress < 1) {
        const offset = Math.abs(x + (1 - progress) * 13 + 3 * Math.sin(progress * 4)) / (4 + progress * 9);
        const weight = Math.min(1, progress * 5, (1 - progress) * 10);
        depth = Math.max(depth, Math.max(0, 1 - offset * offset) * weight * (3 + progress * 5));
        rim = Math.max(rim, Math.max(0, 1 - Math.abs(offset - 1) * 5) * weight * 2.8);
        disturbed ||= offset < 1.23;
      }
    }
    for (const impact of groundImpacts) {
      const d = Math.hypot(x - impact.x, z - impact.z) / impact.radius;
      if (d >= 1.2) continue;
      depth = Math.max(depth, Math.max(0, 1 - (d / 0.88) ** 2) * impact.depth);
      rim = Math.max(rim, Math.max(0, 1 - Math.abs(d - 0.96) * 6) * 1.8);
      disturbed = true;
    }
    const y = -1 + Math.round(rim - depth + (disturbed ? (noise(x, 0, z) - 0.5) * 0.65 : 0));
    const grain = noise(x, 9, z);
    const block = !disturbed ? B.Grass
      : depth >= 2.5 ? (grain < 0.22 ? B.Cobblestone : B.BrownTerracotta)
      : rim >= 0.8 ? (grain < 0.28 ? B.Sandstone : B.CoarseDirt)
      : grain < 0.16 ? B.Cobblestone : B.CoarseDirt;
    return { y, block };
  }

  function rockColumn(x: number, z: number) {
    const nx = (x + z * (condition === "skid" ? 0.20 : 0.04)) / (condition === "skid" ? rx * 0.87 : rx);
    const nz = z / (condition === "skid" ? rz * 1.14 : rz);
    const angle = Math.atan2(nz, nx) + phase;
    const cleft = hull === "splitGeode" ? 1.8 * Math.exp(-(((x - 2 * Math.sin(z * 0.18)) / 3) ** 2)) : 0;
    const center = (condition === "impact" ? -3 : 10) + (condition === "skid" ? z * 0.23 : x * 0.04) - cleft;
    const verticalRadius = condition === "skid" ? height * 0.74 : height;
    const contour = 1 + (lobes === 3 ? 0.038 : 0.024) * Math.cos(lobes * angle) + 0.022 * Math.cos(5 * angle);
    return (y: number): BlockId | undefined => {
      const ny = (y - center) / verticalRadius;
      const distance = Math.hypot(nx, ny, nz);
      const grain = noise(x, y, z);
      const roughness = Math.sin(x * 0.42 + z * 0.31) * Math.cos(y * 0.36 - phase) * 0.026 + (grain - 0.5) * 0.035;
      let boundary = contour + roughness;
      if (distance > boundary + 0.08) return;
      let crater = false;
      if (distance > 0.56 && ny > -0.2) {
        for (const impact of impacts) {
          const projection = (nx * impact.x + ny * impact.y + nz * impact.z) / distance;
          if (projection < 0.91) continue;
          const r = Math.sqrt(Math.max(0, 2 - 2 * projection)) / impact.radius;
          if (r >= 1.22) continue;
          const bowl = Math.max(0, 1 - (r / 0.94) ** 2) ** 0.75;
          const lip = Math.max(0, 1 - Math.abs(r - 1.03) * 5.5) * 0.045;
          boundary += lip - impact.depth * bowl;
          crater = true;
        }
      }
      if (distance > boundary) return;
      if (shattered && x > rx * 0.33 + 3 * Math.sin(z * 0.30) + (y - outerY) * 0.16 && y > outerY + 8 + grain * 2) return;

      const layer = Math.sin(y * 0.30 + x * 0.12 - z * 0.09 + phase) + Math.cos(x * 0.31 + z * 0.22) * 0.57;
      const surface = distance > boundary - 0.10;
      if (surface && hull === "splitGeode" && crater && grain < 0.025) return B.CryingObsidian;
      if (surface && (layer > 0.80 || (crater && distance < contour - 0.08 && grain > 0.23))) {
        return WEATHERED[Math.floor(grain * WEATHERED.length)];
      }
      const patch = noise(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3));
      return STONE[Math.floor(patch * STONE.length)];
    };
  }
  return { groundAt, rockColumn };
}
