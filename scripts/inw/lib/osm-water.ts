import { readFileSync } from "node:fs";
import { toUtm, utmToBlock } from "../../../src/lib/inw/grid.ts";

export type Ring = Float64Array;

export type WaterKind = "lake" | "river";

export type WaterArea = {
  id: string;
  name: string;
  kind: WaterKind;
  /** Block-space rings, x then z, closed. Outer and inner rings together, filled even-odd. */
  rings: Ring[];
  bbox: { x0: number; z0: number; x1: number; z1: number };
  area: number;
};

export type WaterLine = {
  id: string;
  kind: string;
  /** Block-space polyline, x then z. */
  points: Float64Array;
  width: number;
  depth: number;
  bbox: { x0: number; z0: number; x1: number; z1: number };
};

type OsmPoint = { lat: number; lon: number };
type OsmMember = { type: string; role: string; geometry?: OsmPoint[] };
type OsmElement = {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
  members?: OsmMember[];
};

const LINE_STYLE: Record<string, { width: number; depth: number }> = {
  river: { width: 10, depth: 2.5 },
  canal: { width: 5, depth: 1.5 },
  stream: { width: 2, depth: 1 },
  ditch: { width: 1, depth: 0.5 },
  drain: { width: 1, depth: 0.5 },
};

const SKIPPED_WATER = new Set(["basin", "spillway", "fountain", "pool", "swimming_pool"]);

function project(points: OsmPoint[]): Float64Array {
  const out = new Float64Array(points.length * 2);
  points.forEach((point, i) => {
    const utm = toUtm(point.lat, point.lon);
    const block = utmToBlock(utm.e, utm.n);
    out[i * 2] = block.x;
    out[i * 2 + 1] = block.z;
  });
  return out;
}

function bboxOf(arrays: Float64Array[]) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const points of arrays) {
    for (let i = 0; i < points.length; i += 2) {
      x0 = Math.min(x0, points[i]);
      x1 = Math.max(x1, points[i]);
      z0 = Math.min(z0, points[i + 1]);
      z1 = Math.max(z1, points[i + 1]);
    }
  }
  return { x0, z0, x1, z1 };
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i + 3 < ring.length; i += 2) sum += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
  return sum / 2;
}

/** Joins member ways that share end points into closed rings. Open leftovers are dropped. */
function assembleRings(parts: OsmPoint[][]): OsmPoint[][] {
  const key = (point: OsmPoint) => `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
  const pending = parts.filter((part) => part.length >= 2).map((part) => [...part]);
  const rings: OsmPoint[][] = [];
  while (pending.length > 0) {
    let ring = pending.pop()!;
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < pending.length; i += 1) {
        const part = pending[i];
        if (key(part[0]) === end) ring = ring.concat(part.slice(1));
        else if (key(part[part.length - 1]) === end) ring = ring.concat([...part].reverse().slice(1));
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function classify(tags: Record<string, string>): WaterKind | null {
  if (tags.waterway === "riverbank") return "river";
  if (tags.natural === "water" || tags.landuse === "reservoir") {
    const water = tags.water ?? "";
    if (SKIPPED_WATER.has(water)) return null;
    if (tags.intermittent === "yes" || tags.seasonal === "yes") return null;
    if (water === "river" || water === "canal" || water === "stream" || water === "oxbow") return water === "oxbow" ? "lake" : "river";
    return "lake";
  }
  return null;
}

export function loadOsmWater(file: string): { areas: WaterArea[]; lines: WaterLine[] } {
  const elements = (JSON.parse(readFileSync(file, "utf8")) as { elements: OsmElement[] }).elements;
  const areas: WaterArea[] = [];
  const lines: WaterLine[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === "way" && element.geometry && LINE_STYLE[tags.waterway ?? ""] && !classify(tags)) {
      if (tags.intermittent === "yes" || tags.seasonal === "yes") continue;
      if (tags.tunnel && tags.tunnel !== "no") continue;
      if (tags.location === "underground") continue;
      const style = LINE_STYLE[tags.waterway!];
      const width = Number.parseFloat(tags.width ?? "") || style.width;
      const points = project(element.geometry);
      lines.push({
        id: `way/${element.id}`,
        kind: tags.waterway!,
        points,
        width: Math.max(1, Math.min(30, width)),
        depth: style.depth,
        bbox: bboxOf([points]),
      });
      continue;
    }
    const kind = classify(tags);
    if (!kind) continue;
    let rings: OsmPoint[][] = [];
    if (element.type === "way" && element.geometry) {
      rings = assembleRings([element.geometry]);
    } else if (element.type === "relation" && element.members) {
      rings = assembleRings(element.members.filter((member) => member.type === "way" && member.geometry).map((member) => member.geometry!));
    }
    if (rings.length === 0) continue;
    const projected = rings.map(project);
    const outer = projected.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    areas.push({
      id: `${element.type}/${element.id}`,
      name: tags.name ?? "",
      kind,
      rings: projected,
      bbox: bboxOf(projected),
      area: outer,
    });
  }
  return { areas, lines };
}
