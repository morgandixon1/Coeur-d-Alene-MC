import { toUtm, utmToBlock } from "@/lib/inw/grid";

export type Point2D = [x: number, z: number];
export type Ring2D = Point2D[];
/** First ring is exterior shell; subsequent rings are courtyard/interior holes. */
export type Polygon2D = Ring2D[];

export type Rect2D = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
};

export type OvertureBuildingProperties = {
  height?: number | null;
  num_floors?: number | null;
  subtype?: string | null;
  class?: string | null;
  roof_shape?: string | null;
  roof_direction?: number | null;
  has_parts?: boolean | null;
  is_underground?: boolean | null;
  [key: string]: unknown;
};

export type OvertureGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type OvertureBuildingFeature = {
  type: "Feature";
  id: string;
  properties?: OvertureBuildingProperties | null;
  geometry: OvertureGeometry;
};

export type MeasuredEnvelope = {
  centerX: number;
  centerZ: number;
  lengthM: number;
  widthM: number;
  axisBearingDeg: number | null;
};

export type ProjectedFootprint = {
  id: string;
  seed: number;
  polygons: Polygon2D[];
  envelope: MeasuredEnvelope;
  cells: [number, number][];
  components: [number, number][][];
  bounds: Rect2D;
  properties: OvertureBuildingProperties;
};

/** Deterministic unsigned 32-bit seed from an arbitrary source feature ID (FNV-1a). */
export function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Normalize a world vector (dx, dz) to an axis bearing in [0, 180) clockwise from north (-Z). */
export function axisBearingFromVector(dx: number, dz: number): number {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const mod = ((deg % 180) + 180) % 180;
  return mod >= 180 - 1e-9 || mod < 1e-9 ? 0 : mod;
}

/** Normalize a world vector (dx, dz) to a directed bearing in [0, 360) clockwise from north (-Z). */
export function bearingFromVector(dx: number, dz: number): number {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const mod = ((deg % 360) + 360) % 360;
  return mod >= 360 - 1e-9 || mod < 1e-9 ? 0 : mod;
}

export function projectLonLat(lon: number, lat: number): Point2D {
  const { e, n } = toUtm(lat, lon);
  const { x, z } = utmToBlock(e, n);
  return [x, z];
}

function closeRing(ring: Ring2D): Ring2D {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}

export function projectGeometry(geometry: OvertureGeometry): Polygon2D[] {
  const rawPolygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return rawPolygons.map((polygon) =>
    polygon.map((ring) => closeRing(ring.map(([lon, lat]) => projectLonLat(lon, lat)))),
  );
}

/** Ray-casting point-in-ring test for closed rings. */
export function insideRing(ring: Ring2D, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[j]!;
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

export function insidePolygon(polygon: Polygon2D, x: number, z: number): boolean {
  if (polygon.length === 0) return false;
  const [shell, ...holes] = polygon;
  if (!insideRing(shell!, x, z)) return false;
  return !holes.some((hole) => insideRing(hole, x, z));
}

/** Rasterize a polygon to integer (x, z) cells sampled at cell centers (x + 0.5, z + 0.5). */
export function rasterizePolygon(polygon: Polygon2D): [number, number][] {
  const shell = polygon[0];
  if (!shell || shell.length < 3) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of shell) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const x0 = Math.floor(minX);
  const x1 = Math.ceil(maxX);
  const z0 = Math.floor(minZ);
  const z1 = Math.ceil(maxZ);
  const cells: [number, number][] = [];
  for (let z = z0; z < z1; z += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (insidePolygon(polygon, x + 0.5, z + 0.5)) {
        cells.push([x, z]);
      }
    }
  }
  return cells;
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain 2D convex hull (counter-clockwise, no duplicate closing vertex). */
function convexHull(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: Point2D[] = [];
  for (const p of sorted) {
    const prev = unique[unique.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-9) unique.push(p);
  }
  if (unique.length <= 2) return unique;

  const lower: Point2D[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Compute the minimum-area rotated bounding rectangle over all exterior vertices.
 * Envelopes within 2% of square emit axisBearingDeg: null.
 */
export function minimumRotatedRectangle(polygons: Polygon2D[]): MeasuredEnvelope {
  const points: Point2D[] = [];
  for (const poly of polygons) {
    const shell = poly[0];
    if (!shell) continue;
    for (let i = 0; i < shell.length - 1; i += 1) points.push(shell[i]!);
  }
  const hull = convexHull(points);
  if (hull.length === 0) {
    return { centerX: 0, centerZ: 0, lengthM: 0, widthM: 0, axisBearingDeg: null };
  }
  if (hull.length === 1) {
    return { centerX: hull[0]![0], centerZ: hull[0]![1], lengthM: 0, widthM: 0, axisBearingDeg: null };
  }

  let bestArea = Infinity;
  let best: MeasuredEnvelope = { centerX: hull[0]![0], centerZ: hull[0]![1], lengthM: 0, widthM: 0, axisBearingDeg: null };

  for (let i = 0; i < hull.length; i += 1) {
    const p0 = hull[i]!;
    const p1 = hull[(i + 1) % hull.length]!;
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 1e-9) continue;

    const ux = dx / edgeLen;
    const uz = dz / edgeLen;
    const vx = -uz;
    const vz = ux;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [px, pz] of hull) {
      const u = px * ux + pz * uz;
      const v = px * vx + pz * vz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const spanU = maxU - minU;
    const spanV = maxV - minV;
    const area = spanU * spanV;
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const midU = (minU + maxU) / 2;
      const midV = (minV + maxV) / 2;
      const centerX = midU * ux + midV * vx;
      const centerZ = midU * uz + midV * vz;
      const lengthM = Math.max(spanU, spanV);
      const widthM = Math.min(spanU, spanV);
      const isAmbiguousSquare = lengthM > 0 && Math.abs(lengthM - widthM) / lengthM <= 0.02;
      const longVec = spanU >= spanV ? [ux, uz] : [vx, vz];
      best = {
        centerX,
        centerZ,
        lengthM,
        widthM,
        axisBearingDeg: isAmbiguousSquare ? null : axisBearingFromVector(longVec[0]!, longVec[1]!),
      };
    }
  }
  return best;
}

/** Merge integer (x, z) columns into compact half-open clearance rectangles { x0, z0, x1, z1 }. */
export function cellsToClearanceRects(cells: Iterable<readonly [number, number]>): Rect2D[] {
  const rows = new Map<number, number[]>();
  const seen = new Set<string>();
  for (const [x, z] of cells) {
    const k = `${x},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let row = rows.get(z);
    if (!row) {
      row = [];
      rows.set(z, row);
    }
    row.push(x);
  }
  const sortedZ = [...rows.keys()].sort((a, b) => a - b);
  const active = new Map<string, Rect2D>();
  const finished: Rect2D[] = [];

  for (const z of sortedZ) {
    const xs = rows.get(z)!.sort((a, b) => a - b);
    const nextActive = new Map<string, Rect2D>();
    let i = 0;
    while (i < xs.length) {
      const x0 = xs[i]!;
      let x1 = x0 + 1;
      while (i + 1 < xs.length && xs[i + 1]! === x1) {
        i += 1;
        x1 += 1;
      }
      i += 1;
      const spanKey = `${x0},${x1}`;
      const existing = active.get(spanKey);
      if (existing && existing.z1 === z) {
        existing.z1 = z + 1;
        nextActive.set(spanKey, existing);
        active.delete(spanKey);
      } else {
        nextActive.set(spanKey, { x0, z0: z, x1, z1: z + 1 });
      }
    }
    for (const rect of active.values()) finished.push(rect);
    active.clear();
    for (const [k, rect] of nextActive) active.set(k, rect);
  }
  for (const rect of active.values()) finished.push(rect);
  return finished.sort((a, b) => a.z0 - b.z0 || a.x0 - b.x0);
}

export function projectBuildingFeature(
  feature: OvertureBuildingFeature,
  seedOverride?: number,
): ProjectedFootprint {
  const polygons = projectGeometry(feature.geometry);
  const envelope = minimumRotatedRectangle(polygons);
  const components = polygons.map(rasterizePolygon);
  const seen = new Set<string>();
  const cells: [number, number][] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const comp of components) {
    for (const [x, z] of comp) {
      const k = `${x},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push([x, z]);
      if (x < minX) minX = x;
      if (x + 1 > maxX) maxX = x + 1;
      if (z < minZ) minZ = z;
      if (z + 1 > maxZ) maxZ = z + 1;
    }
  }
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const bounds: Rect2D =
    cells.length > 0
      ? { x0: minX, z0: minZ, x1: maxX, z1: maxZ }
      : { x0: 0, z0: 0, x1: 0, z1: 0 };

  return {
    id: feature.id,
    seed: (seedOverride ?? seedFromId(feature.id)) >>> 0,
    polygons,
    envelope,
    cells,
    components,
    bounds,
    properties: feature.properties ?? {},
  };
}

/** Parse Overture newline-delimited GeoJSONSeq, deduplicating by source feature ID. */
export function parseBuildingsGeoJsonSeq(text: string): OvertureBuildingFeature[] {
  const seen = new Set<string>();
  const features: OvertureBuildingFeature[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = JSON.parse(line) as OvertureBuildingFeature;
    if (
      !parsed ||
      parsed.type !== "Feature" ||
      typeof parsed.id !== "string" ||
      !parsed.geometry ||
      (parsed.geometry.type !== "Polygon" && parsed.geometry.type !== "MultiPolygon")
    ) {
      continue;
    }
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    features.push(parsed);
  }
  return features;
}
