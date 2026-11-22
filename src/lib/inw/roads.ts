/** 0 highway, 1 primary, 2 secondary or tertiary, 3 street. Widths are metres, one block each. */
export const ROAD_WIDTH = [16, 10, 7, 5] as const;

/** Vanilla concrete tops: light gray, light gray, gray, gray. Index 4 is the highway centre line (yellow concrete). */
export const ROAD_RGB: [number, number, number][] = [
  [125, 125, 115],
  [125, 125, 115],
  [76, 79, 82],
  [54, 57, 61],
  [241, 175, 21],
];

export type Road = {
  kind: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  xs: Int16Array;
  zs: Int16Array;
};

/** Little-endian: uint32 count, then per way uint8 class, uint16 points, int16 x/z pairs. */
export function decodeRoads(buffer: ArrayBuffer): Road[] {
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const roads: Road[] = [];
  let offset = 4;
  for (let way = 0; way < count; way += 1) {
    const kind = view.getUint8(offset);
    const points = view.getUint16(offset + 1, true);
    offset += 3;
    const xs = new Int16Array(points);
    const zs = new Int16Array(points);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < points; i += 1) {
      const x = view.getInt16(offset, true);
      const z = view.getInt16(offset + 2, true);
      xs[i] = x;
      zs[i] = z;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
      offset += 4;
    }
    if (points >= 2) roads.push({ kind, x0, z0, x1, z1, xs, zs });
  }
  return roads;
}

/**
 * One byte per cell. 0 is ground. 1–4 are highway, primary, secondary, street.
 * 5 is the one-metre yellow centre line, written only when each cell is one metre.
 * `step` is metres per cell, so a coarse map sample still catches the road that crosses it.
 */
export function rasterRoads(roads: Road[], x0: number, z0: number, size: number, step = 1): Uint8Array {
  const cells = new Uint8Array(size * size);
  const span = size * step;
  for (const road of roads) {
    const radius = ROAD_WIDTH[road.kind] / 2;
    const reach = Math.max(radius, step * 0.45);
    if (road.x1 < x0 - reach || road.x0 > x0 + span + reach || road.z1 < z0 - reach || road.z0 > z0 + span + reach) continue;
    const limit = reach * reach;
    const center = step === 1 && road.kind === 0 ? 0.55 * 0.55 : -1;
    for (let i = 0; i < road.xs.length - 1; i += 1) {
      const ax = road.xs[i];
      const az = road.zs[i];
      const bx = road.xs[i + 1];
      const bz = road.zs[i + 1];
      const minX = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step));
      const maxX = Math.min(size - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step));
      const minZ = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / step));
      const maxZ = Math.min(size - 1, Math.ceil((Math.max(az, bz) + reach - z0) / step));
      const dx = bx - ax;
      const dz = bz - az;
      const length2 = dx * dx + dz * dz || 1;
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x0 + (x + 0.5) * step - ax;
          const pz = z0 + (z + 0.5) * step - az;
          const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / length2));
          const ex = px - t * dx;
          const ez = pz - t * dz;
          const dist2 = ex * ex + ez * ez;
          if (dist2 > limit) continue;
          const mark = dist2 <= center ? 5 : road.kind + 1;
          const rank = mark === 5 ? 0 : mark;
          const at = z * size + x;
          const prev = cells[at] === 5 ? 0 : cells[at];
          if (cells[at] === 0 || rank < prev) cells[at] = mark;
        }
      }
    }
  }
  return cells;
}
