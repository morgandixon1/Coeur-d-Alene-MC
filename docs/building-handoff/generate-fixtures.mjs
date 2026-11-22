import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [argument, repo] = process.argv.slice(2);
if (argument !== "--repo" || !repo) {
  throw new Error("From the Inland Northwest app root run: node --import tsx /path/to/generate-fixtures.mjs --repo .");
}
const { ORIGIN, blockToUtm, fromUtm, toUtm, utmToBlock } =
  await import(pathToFileURL(path.resolve(repo, "src/lib/inw/grid.ts")).href);

const directory = fileURLToPath(new URL("./fixtures", import.meta.url));
await mkdir(directory, { recursive: true });

const terrain = {
  crop: { x0: -128, z0: -128, size: 256 },
  groundY: 64,
  roads: [{ x0: -96, z0: -70, x1: -38, z1: -64 }],
  water: [{ x0: 78, z0: 66, x1: 108, z1: 100 }],
  poi: [{ x0: 10, z0: 85, x1: 27, z1: 105 }],
};

const rectangle = (length, width) => [
  [-length / 2, -width / 2], [length / 2, -width / 2],
  [length / 2, width / 2], [-length / 2, width / 2],
];
const scenarios = [
  { id: "rotated-32", center: [42, -38], bearing: 32, expectedBearing: 32, length: 18, width: 10, height: 7.2,
    polygons: [[rectangle(18, 10)]] },
  { id: "rotated-l", center: [-52, 36], bearing: 122, expectedBearing: 122, length: 20, width: 14,
    polygons: [[[[-10, -7], [10, -7], [10, -1], [2, -1], [2, 7], [-10, 7]]]] },
  { id: "square", center: [32, 37], bearing: 19, expectedBearing: null, length: 12, width: 12, floors: 2,
    polygons: [[rectangle(12, 12)]] },
  { id: "courtyard-crosses-negative-chunks", center: [-16, -16], bearing: 90, expectedBearing: 90, length: 24, width: 16, height: 8,
    polygons: [[rectangle(24, 16), rectangle(8, 6)]] },
  { id: "multipart", center: [-85, -87], bearing: 90, expectedBearing: 90, length: 22, width: 10, height: 5.8,
    polygons: [[[[ -11, -5], [1, -5], [1, 5], [-11, 5]]], [[[6, -3], [11, -3], [11, 3], [6, 3]]]] },
  { id: "blocked-by-road", center: [-65, -67], bearing: 90, expectedBearing: 90, length: 12, width: 10,
    polygons: [[rectangle(12, 10)]], conflict: "road" },
  { id: "blocked-by-water", center: [92, 81], bearing: 90, expectedBearing: 90, length: 14, width: 10,
    polygons: [[rectangle(14, 10)]], conflict: "water" },
  { id: "blocked-by-poi", center: [18, 95], bearing: 90, expectedBearing: 90, length: 14, width: 10,
    polygons: [[rectangle(14, 10)]], conflict: "poi" },
];

function rotateRing(ring, [x, z], bearing) {
  const a = bearing * Math.PI / 180;
  // u follows the building axis; v points to its right. World north is negative Z.
  const result = ring.map(([u, v]) => [
    x + u * Math.sin(a) + v * Math.cos(a),
    z - u * Math.cos(a) + v * Math.sin(a),
  ]);
  result.push(result[0]);
  return result;
}

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function cellsFor(polygons) {
  const points = polygons.flat(1).flat(1);
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minZ = Math.floor(Math.min(...points.map(([, z]) => z)));
  const maxZ = Math.ceil(Math.max(...points.map(([, z]) => z)));
  const cells = [];
  for (let z = minZ; z < maxZ; z++) {
    for (let x = minX; x < maxX; x++) {
      if (polygons.some(([shell, ...holes]) => insideRing(shell, x + 0.5, z + 0.5) &&
          !holes.some((hole) => insideRing(hole, x + 0.5, z + 0.5)))) cells.push([x, z]);
    }
  }
  return cells;
}

function geoPoint([x, z]) {
  const { e, n } = blockToUtm(x, z);
  const { lon, lat } = fromUtm(e, n);
  const rounded = [Number(lon.toFixed(9)), Number(lat.toFixed(9))];
  const roundTrip = toUtm(rounded[1], rounded[0]);
  const local = utmToBlock(roundTrip.e, roundTrip.n);
  assert.ok(Math.hypot(local.x - x, local.z - z) < 0.02, "GeoJSON projection round trip");
  return rounded;
}

const features = [];
const cases = [];
for (const scenario of scenarios) {
  const polygons = scenario.polygons.map((polygon) => polygon.map((ring) => rotateRing(ring, scenario.center, scenario.bearing)));
  const cells = cellsFor(polygons);
  const geometry = polygons.map((polygon) => polygon.map((ring, ringIndex) => (ringIndex === 0 ? [...ring].reverse() : ring).map(geoPoint)));
  const conflicts = Object.entries({ road: terrain.roads, water: terrain.water, poi: terrain.poi })
    .filter(([, zones]) => cells.some(([x, z]) => zones.some((b) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1)))
    .map(([kind]) => kind);
  assert.deepEqual(conflicts, scenario.conflict ? [scenario.conflict] : [], `${scenario.id} exclusion fixture`);

  const { id, center, expectedBearing, length, width, height, floors, conflict } = scenario;
  features.push({
    type: "Feature",
    id,
    properties: { subtype: "residential", ...(height ? { height } : {}), ...(floors ? { num_floors: floors } : {}) },
    geometry: polygons.length === 1 ? { type: "Polygon", coordinates: geometry[0] } : { type: "MultiPolygon", coordinates: geometry },
  });
  cases.push({
    id,
    expected: { envelopeCenterXZ: center, axisBearingDeg: expectedBearing, lengthM: length, widthM: width,
      heightM: height ?? null, floors: floors ?? null, placement: conflict ? "skipped" : "eligible", reason: conflict ?? null },
    worldPolygonsXZ: polygons,
    footprintCellsXZ: cells,
  });
}

const courtyard = cases.find((c) => c.id.startsWith("courtyard"));
assert.equal(courtyard.footprintCellsXZ.length, 24 * 16 - 8 * 6);
assert.ok(!courtyard.footprintCellsXZ.some(([x, z]) => x === -16 && z === -16));
assert.ok(courtyard.footprintCellsXZ.some(([x, z]) => Math.floor(x / 16) === -2 && Math.floor(z / 16) === -2));

await writeFile(path.join(directory, "synthetic-buildings.geojsonseq"), features.map((feature) => JSON.stringify(feature)).join("\n") + "\n");
await writeFile(path.join(directory, "expected-world.json"), JSON.stringify({
  format: "inw-building-fixtures-v1", utmOrigin: ORIGIN, terrain, cases,
}, (key, value) => key === "footprintCellsXZ" ? undefined : value, 2) + "\n");
await writeFile(path.join(directory, "expected-footprint-cells.json"), JSON.stringify(
  Object.fromEntries(cases.map(({ id, footprintCellsXZ }) => [id, footprintCellsXZ])),
) + "\n");
console.log(`Verified fixtures for ${cases.length} synthetic buildings at grid origin E ${ORIGIN.e}, N ${ORIGIN.n}.`);
