/** A grid of cells `res` blocks wide whose north-west corner is block (x0, z0). */
export type Grid = { x0: number; z0: number; res: number; width: number; height: number };

/** Even-odd scanline fill of block-space rings, sampled at cell centers. Calls `hit(index)` per inside cell. */
export function fillRings(grid: Grid, rings: Float64Array[], hit: (index: number) => void) {
  type Edge = { za: number; zb: number; xa: number; slope: number };
  const buckets: Edge[][] = Array.from({ length: grid.height }, () => []);
  for (const ring of rings) {
    for (let i = 0; i + 3 < ring.length; i += 2) {
      let xa = ring[i];
      let za = ring[i + 1];
      let xb = ring[i + 2];
      let zb = ring[i + 3];
      if (za === zb) continue;
      if (za > zb) [xa, za, xb, zb] = [xb, zb, xa, za];
      const first = Math.max(0, Math.ceil((za - grid.z0) / grid.res - 0.5));
      const last = Math.min(grid.height - 1, Math.ceil((zb - grid.z0) / grid.res - 0.5) - 1);
      if (last < first) continue;
      buckets[first].push({ za, zb, xa, slope: (xb - xa) / (zb - za) });
    }
  }
  let active: Edge[] = [];
  const crossings: number[] = [];
  for (let row = 0; row < grid.height; row += 1) {
    const zc = grid.z0 + (row + 0.5) * grid.res;
    if (buckets[row].length > 0) active = active.concat(buckets[row]);
    if (active.length === 0) continue;
    active = active.filter((edge) => edge.zb > zc);
    crossings.length = 0;
    for (const edge of active) if (edge.za <= zc) crossings.push(edge.xa + (zc - edge.za) * edge.slope);
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - grid.x0) / grid.res - 0.5));
      const to = Math.min(grid.width - 1, Math.ceil((crossings[k + 1] - grid.x0) / grid.res - 0.5) - 1);
      for (let col = from; col <= to; col += 1) hit(row * grid.width + col);
    }
  }
}

/** Visits every cell within `radius` blocks of the polyline. */
export function strokeLine(grid: Grid, points: Float64Array, radius: number, hit: (index: number) => void) {
  const reach = radius / grid.res;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = (points[i] - grid.x0) / grid.res;
    const az = (points[i + 1] - grid.z0) / grid.res;
    const bx = (points[i + 2] - grid.x0) / grid.res;
    const bz = (points[i + 3] - grid.z0) / grid.res;
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const c1 = Math.min(grid.width - 1, Math.ceil(Math.max(ax, bx) + reach));
    const r0 = Math.max(0, Math.floor(Math.min(az, bz) - reach));
    const r1 = Math.min(grid.height - 1, Math.ceil(Math.max(az, bz) + reach));
    const dx = bx - ax;
    const dz = bz - az;
    const length2 = dx * dx + dz * dz || 1;
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const px = col + 0.5 - ax;
        const pz = row + 0.5 - az;
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / length2));
        const ex = px - t * dx;
        const ez = pz - t * dz;
        if (ex * ex + ez * ez <= reach * reach) hit(row * grid.width + col);
      }
    }
  }
}

/** Two-pass chamfer distance, in blocks, from every cell to the nearest cell where `source` is set. */
export function distanceTo(grid: Grid, source: Uint8Array): Float32Array {
  const { width, height } = grid;
  const far = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i += 1) dist[i] = source[i] ? 0 : far;
  const diagonal = Math.SQRT2;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const i = row * width + col;
      let best = dist[i];
      if (col > 0) best = Math.min(best, dist[i - 1] + 1);
      if (row > 0) {
        best = Math.min(best, dist[i - width] + 1);
        if (col > 0) best = Math.min(best, dist[i - width - 1] + diagonal);
        if (col < width - 1) best = Math.min(best, dist[i - width + 1] + diagonal);
      }
      dist[i] = best;
    }
  }
  for (let row = height - 1; row >= 0; row -= 1) {
    for (let col = width - 1; col >= 0; col -= 1) {
      const i = row * width + col;
      let best = dist[i];
      if (col < width - 1) best = Math.min(best, dist[i + 1] + 1);
      if (row < height - 1) {
        best = Math.min(best, dist[i + width] + 1);
        if (col < width - 1) best = Math.min(best, dist[i + width + 1] + diagonal);
        if (col > 0) best = Math.min(best, dist[i + width - 1] + diagonal);
      }
      dist[i] = best;
    }
  }
  for (let i = 0; i < dist.length; i += 1) dist[i] *= grid.res;
  return dist;
}

/**
 * Smooth (harmonic) fill: cells with `fixed` set keep their value, the rest settle to the average of
 * their neighbors. Red-black over-relaxation; `values` holds the starting guess and the result.
 */
export function relax(grid: Grid, values: Float32Array, fixed: Uint8Array, iterations: number) {
  const { width, height } = grid;
  const omega = 1.92;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let color = 0; color < 2; color += 1) {
      for (let row = 1; row < height - 1; row += 1) {
        let col = 1 + ((row + color) & 1);
        for (; col < width - 1; col += 2) {
          const i = row * width + col;
          if (fixed[i]) continue;
          const average = (values[i - 1] + values[i + 1] + values[i - width] + values[i + width]) * 0.25;
          values[i] += omega * (average - values[i]);
        }
      }
    }
  }
}
