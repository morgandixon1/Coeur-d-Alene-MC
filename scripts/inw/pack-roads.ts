/**
 * Pack data/sources/osm/roads.json into data/world/roads.bin.
 * The JSON is an Overpass download of highway ways. See data/sources/osm/roads.overpassql.
 *
 *   node --import tsx scripts/inw/pack-roads.ts
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toUtm, utmToBlock } from "../../src/lib/inw/grid.ts";
import { SOURCES_DIR, WORLD_DIR } from "../../src/lib/inw/store.ts";

const CLASS_OF: Record<string, number> = {
  motorway: 0,
  motorway_link: 0,
  trunk: 0,
  trunk_link: 0,
  primary: 1,
  primary_link: 1,
  secondary: 2,
  secondary_link: 2,
  tertiary: 2,
  tertiary_link: 2,
  unclassified: 3,
  residential: 3,
  living_street: 3,
};

type OsmPoint = { lat: number; lon: number };
type OsmWay = { type: string; tags?: Record<string, string>; geometry?: OsmPoint[] };

function project(points: OsmPoint[]): { xs: number[]; zs: number[] } | null {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const point of points) {
    const utm = toUtm(point.lat, point.lon);
    const block = utmToBlock(utm.e, utm.n);
    const x = Math.round(block.x);
    const z = Math.round(block.z);
    if (Math.abs(x) > 32767 || Math.abs(z) > 32767) return null;
    if (xs.length > 0 && xs[xs.length - 1] === x && zs[zs.length - 1] === z) continue;
    xs.push(x);
    zs.push(z);
  }
  return xs.length >= 2 ? { xs, zs } : null;
}

const json = JSON.parse(readFileSync(path.join(SOURCES_DIR, "osm", "roads.json"), "utf8")) as { elements?: OsmWay[] };
const ways: { kind: number; xs: number[]; zs: number[] }[] = [];
for (const element of json.elements ?? []) {
  if (element.type !== "way" || !element.geometry) continue;
  const tags = element.tags ?? {};
  if (tags.tunnel && tags.tunnel !== "no") continue;
  const kind = CLASS_OF[tags.highway ?? ""];
  if (kind === undefined) continue;
  const projected = project(element.geometry);
  if (projected) ways.push({ kind, ...projected });
}
ways.sort((a, b) => b.kind - a.kind);

let bytes = 4;
for (const way of ways) bytes += 3 + way.xs.length * 4;
const out = Buffer.alloc(bytes);
out.writeUInt32LE(ways.length, 0);
let offset = 4;
for (const way of ways) {
  out.writeUInt8(way.kind, offset);
  out.writeUInt16LE(way.xs.length, offset + 1);
  offset += 3;
  for (let i = 0; i < way.xs.length; i += 1) {
    out.writeInt16LE(way.xs[i], offset);
    out.writeInt16LE(way.zs[i], offset + 2);
    offset += 4;
  }
}

await mkdir(WORLD_DIR, { recursive: true });
await writeFile(path.join(WORLD_DIR, "roads.bin"), out);
const counts = [0, 0, 0, 0];
for (const way of ways) counts[way.kind] += 1;
console.log(
  `packed ${ways.length} roads (${(out.length / 1e6).toFixed(2)} MB) highway ${counts[0]}, primary ${counts[1]}, secondary ${counts[2]}, street ${counts[3]}`,
);
