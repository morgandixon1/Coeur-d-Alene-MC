export const FILL_DEPTH = 40;
export const BIOME_PLAINS = 1;
export const MAX_API_SIZE = 1024;
export const SIZE_CHOICES = [256, 512, 1024] as const;

export type RegionSpec = {
  /** Inclusive block x of the north-west corner. Rounded down to a chunk. */
  x0: number;
  /** Inclusive block z of the north-west corner. Rounded down to a chunk. */
  z0: number;
  /** Width and depth in blocks. Rounded up to a multiple of 16. */
  size: number;
  name?: string;
};

export type RegionProgress = {
  chunksDone: number;
  chunksTotal: number;
  columns: number;
  wet: number;
};

export function alignRegion(spec: RegionSpec): { x0: number; z0: number; size: number; name: string } {
  if (!Number.isFinite(spec.size) || spec.size < 16) throw new Error("Size must be at least 16 blocks.");
  if (!Number.isFinite(spec.x0) || !Number.isFinite(spec.z0)) throw new Error("Region corner is missing.");
  const x0 = Math.floor(spec.x0 / 16) * 16;
  const z0 = Math.floor(spec.z0 / 16) * 16;
  const size = Math.ceil(spec.size / 16) * 16;
  const name = (spec.name?.trim() || `Inland Northwest ${x0},${z0} ${size}m`).slice(0, 80);
  return { x0, z0, size, name };
}

/** North-west corner for a square of `size` blocks centered on (x, z). */
export function regionAround(x: number, z: number, size: number, name?: string): RegionSpec {
  return { x0: Math.floor(x - size / 2), z0: Math.floor(z - size / 2), size, name };
}

export function exportFileName(spec: { x0: number; z0: number; size: number; name: string }): string {
  const safe = spec.name.replace(/[^\w .-]+/g, "").trim() || "region";
  return `${safe}-${spec.x0}_${spec.z0}-${spec.size}.mcworld`;
}
