import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Database } from "@jsprismarine/leveldb";
import { unzipSync } from "fflate";
import { Block, BLOCKS } from "@/lib/blocks";
import { chunkKey, localIndex, TAG_BLOCK_ENTITY, TAG_SUBCHUNK } from "@/lib/chunk";
import { decodeSubchunk } from "@/lib/chunk-mesh";
import { buildRegionMcworld } from "@/lib/inw/region-world";
import { readNamedCompound } from "@/lib/read-nbt";
import {
  parseBuildingsGeoJsonSeq,
  projectBuildingFeature,
  type OvertureBuildingFeature,
  type Rect2D,
} from "./footprint";
import { rotateQuarterTurn, toCanonicalBlocks } from "./footprint-build";
import { isClearedForFoliage, placeOvertureBuildings, pointInRects } from "./footprint-place";

const FIXTURE_DIR = path.resolve(process.cwd(), "docs/building-handoff/fixtures");

type ExpectedWorld = {
  format: string;
  utmOrigin: { e: number; n: number };
  terrain: {
    crop: { x0: number; z0: number; size: number };
    groundY: number;
    roads: Rect2D[];
    water: Rect2D[];
    poi: Rect2D[];
  };
  cases: {
    id: string;
    expected: {
      envelopeCenterXZ: [number, number];
      axisBearingDeg: number | null;
      lengthM: number;
      widthM: number;
      heightM: number | null;
      floors: number | null;
      placement: "eligible" | "skipped";
      reason: string | null;
    };
    worldPolygonsXZ: number[][][][];
  }[];
};

async function loadFixtures() {
  const [geojsonText, expectedText, cellsText] = await Promise.all([
    readFile(path.join(FIXTURE_DIR, "synthetic-buildings.geojsonseq"), "utf8"),
    readFile(path.join(FIXTURE_DIR, "expected-world.json"), "utf8"),
    readFile(path.join(FIXTURE_DIR, "expected-footprint-cells.json"), "utf8"),
  ]);
  return {
    features: parseBuildingsGeoJsonSeq(geojsonText),
    expectedWorld: JSON.parse(expectedText) as ExpectedWorld,
    expectedCells: JSON.parse(cellsText) as Record<string, [number, number][]>,
  };
}

function angularDiffMod180(a: number, b: number): number {
  const diff = Math.abs(((a - b + 90) % 180 + 180) % 180 - 90);
  return diff;
}

test("Overture projection, rotated rectangle, and raster masks match synthetic fixtures", async () => {
  const { features, expectedWorld, expectedCells } = await loadFixtures();
  assert.equal(features.length, expectedWorld.cases.length);

  for (const feature of features) {
    const projected = projectBuildingFeature(feature);
    const baseline = expectedWorld.cases.find((c) => c.id === feature.id)!;
    assert.ok(baseline, `missing baseline for ${feature.id}`);

    // Geographic projection round-trip <= 0.02 m across every projected vertex.
    assert.equal(projected.polygons.length, baseline.worldPolygonsXZ.length, feature.id);
    for (let p = 0; p < projected.polygons.length; p += 1) {
      for (let r = 0; r < projected.polygons[p]!.length; r += 1) {
        const gotRing = projected.polygons[p]![r]!;
        const expRing = baseline.worldPolygonsXZ[p]![r]!;
        // Outer rings in GeoJSON are reversed relative to generate-fixtures worldPolygonsXZ.
        const aligned = r === 0 ? [...expRing].reverse() : expRing;
        assert.equal(gotRing.length, aligned.length, `${feature.id} ring length`);
        for (let v = 0; v < gotRing.length; v += 1) {
          const dist = Math.hypot(gotRing[v]![0] - aligned[v]![0]!, gotRing[v]![1] - aligned[v]![1]!);
          assert.ok(dist <= 0.02, `${feature.id} vertex ${v} drift ${dist} m > 0.02 m`);
        }
      }
    }

    // Envelope center, dimensions (<= 0.2 m), and bearing (mod 180 <= 0.5 deg or null for square).
    const centerErr = Math.hypot(
      projected.envelope.centerX - baseline.expected.envelopeCenterXZ[0],
      projected.envelope.centerZ - baseline.expected.envelopeCenterXZ[1],
    );
    assert.ok(centerErr <= 0.2, `${feature.id} center error ${centerErr}`);
    assert.ok(Math.abs(projected.envelope.lengthM - baseline.expected.lengthM) <= 0.2, `${feature.id} length`);
    assert.ok(Math.abs(projected.envelope.widthM - baseline.expected.widthM) <= 0.2, `${feature.id} width`);
    if (baseline.expected.axisBearingDeg === null) {
      assert.equal(projected.envelope.axisBearingDeg, null, `${feature.id} square bearing must be null`);
    } else {
      assert.notEqual(projected.envelope.axisBearingDeg, null, `${feature.id} bearing should not be null`);
      const degErr = angularDiffMod180(projected.envelope.axisBearingDeg!, baseline.expected.axisBearingDeg);
      assert.ok(degErr <= 0.5, `${feature.id} bearing error ${degErr} deg`);
    }

    // Raster cell mask comparison.
    const gotSet = new Set(projected.cells.map(([x, z]) => `${x},${z}`));
    const expSet = new Set(expectedCells[feature.id]!.map(([x, z]) => `${x},${z}`));
    assert.deepEqual([...gotSet].sort(), [...expSet].sort(), `${feature.id} raster cell mask mismatch`);
  }
});

test("placement skips road/water/poi/overlap/underground, preserves concavities, and protects clearances", async () => {
  const { features, expectedWorld } = await loadFixtures();
  const { crop, groundY, roads, water, poi } = expectedWorld.terrain;
  const bounds: Rect2D = { x0: crop.x0, z0: crop.z0, x1: crop.x0 + crop.size, z1: crop.z0 + crop.size };

  const context = {
    bounds,
    groundY: () => groundY,
    isRoad: (x: number, z: number) => pointInRects(x, z, roads),
    isWater: (x: number, z: number) => pointInRects(x, z, water),
    isPoi: (x: number, z: number) => pointInRects(x, z, poi),
  };

  const run1 = placeOvertureBuildings(features, context);
  const run2 = placeOvertureBuildings(features, context);
  assert.deepEqual(run1, run2, "placement must be deterministic across reruns");

  for (const c of expectedWorld.cases) {
    const rec = run1.records.find((r) => r.id === c.id)!;
    assert.ok(rec, `missing record for ${c.id}`);
    if (c.expected.placement === "skipped") {
      assert.equal(rec.status, "skipped", `${c.id} should be skipped`);
      assert.equal(rec.reason, c.expected.reason, `${c.id} skip reason`);
    } else {
      assert.equal(rec.status, "placed", `${c.id} should be placed`);
      assert.equal(rec.foundationY, groundY);
      assert.ok(rec.blocks.length > 0);
      assert.ok(rec.chests.length > 0);
      assert.ok(rec.beds.length >= 2);
      assert.ok(rec.doorCell !== null, `${c.id} must have a reachable door`);
      const canonical = toCanonicalBlocks(rec.blocks.slice(0, 5));
      assert.equal(canonical.length, 5);
      assert.ok(canonical.every((b) => b.name.startsWith("minecraft:")));

      // No duplicate voxel positions and no voxel enters road/water/poi masks.
      const seen = new Set<string>();
      for (const b of rec.blocks) {
        const k = `${b.x},${b.y},${b.z}`;
        assert.ok(!seen.has(k), `${c.id} duplicate voxel at ${k}`);
        seen.add(k);
        assert.ok(!pointInRects(b.x, b.z, roads), `${c.id} entered road`);
        assert.ok(!pointInRects(b.x, b.z, water), `${c.id} entered water`);
        assert.ok(!pointInRects(b.x, b.z, poi), `${c.id} entered poi`);
        assert.ok(pointInRects(b.x, b.z, rec.clearances), `${c.id} block column missing from clearances`);
        assert.ok(!isClearedForFoliage(b.x, b.z, run1.clearances, 2), `${c.id} foliage clearance violation`);
      }
    }
  }

  // Verify courtyard hole is open air at (-16, -16).
  const courtyard = run1.placed.find((b) => b.id === "courtyard-crosses-negative-chunks")!;
  assert.ok(!courtyard.blocks.some((b) => b.x === -16 && b.z === -16), "courtyard hole must stay open");
  assert.ok(courtyard.blocks.some((b) => Math.floor(b.x / 16) === -2 && Math.floor(b.z / 16) === -2), "must cross negative chunks");

  // Verify multipart gap is open between components (around x = -81, z = -87).
  const multipart = run1.placed.find((b) => b.id === "multipart")!;
  assert.ok(!multipart.blocks.some((b) => b.x === -81 && b.z === -87), "multipart gap must stay open");

  // Verify square 2-story height assumption uses source_floors.
  const square = run1.placed.find((b) => b.id === "square")!;
  assert.equal(square.stories, 2);
  assert.equal(square.heightAssumption, "source_floors");

  // Adjacent-building overlap regression & underground skip.
  const firstFeature = features[0]!;
  const overlappingCopy: OvertureBuildingFeature = {
    ...firstFeature,
    id: `${firstFeature.id}-overlap`,
  };
  const undergroundCopy: OvertureBuildingFeature = {
    ...firstFeature,
    id: `${firstFeature.id}-underground`,
    properties: { ...firstFeature.properties, is_underground: true },
  };
  const overlapRun = placeOvertureBuildings([firstFeature, overlappingCopy, undergroundCopy], context);
  assert.equal(overlapRun.records[0]!.status, "placed");
  assert.equal(overlapRun.records[1]!.status, "skipped");
  assert.equal(overlapRun.records[1]!.status === "skipped" && overlapRun.records[1]!.reason, "building_overlap");
  assert.equal(overlapRun.records[2]!.status, "skipped");
  assert.equal(overlapRun.records[2]!.status === "skipped" && overlapRun.records[2]!.reason, "underground");

  // Quarter-turn rotation transforms cardinal block states and entity coordinates together.
  const rotated = rotateQuarterTurn(
    {
      blocks: [
        { x: 2, y: 65, z: 0, block: Block.OakDoorLower },
        { x: 2, y: 66, z: 0, block: Block.OakDoorUpper },
      ],
      chests: [{ x: 2, y: 65, z: 1, label: "Pantry", items: [{ name: "minecraft:bread", count: 2 }] }],
      beds: [{ x: 1, y: 65, z: 0 }],
    },
    1,
    0,
    0,
  );
  assert.deepEqual(rotated.blocks, [
    { x: 0, y: 65, z: 2, block: Block.OakDoorEastLower },
    { x: 0, y: 66, z: 2, block: Block.OakDoorEastUpper },
  ]);
  assert.equal(rotated.chests[0]!.x, -1);
  assert.equal(rotated.chests[0]!.z, 2);
  assert.equal(rotated.beds[0]!.x, 0);
  assert.equal(rotated.beds[0]!.z, 1);
});

test("synthetic regional .mcworld preserves walls, roofs, roads, doors, chests, beds, and negative chunks", async () => {
  const { features, expectedWorld } = await loadFixtures();
  const { crop, groundY, roads, water, poi } = expectedWorld.terrain;
  const bounds: Rect2D = { x0: crop.x0, z0: crop.z0, x1: crop.x0 + crop.size, z1: crop.z0 + crop.size };

  const placement = placeOvertureBuildings(features, {
    bounds,
    groundY: () => groundY,
    isRoad: (x, z) => pointInRects(x, z, roads),
    isWater: (x, z) => pointInRects(x, z, water),
    isPoi: (x, z) => pointInRects(x, z, poi),
  });

  const built = await buildRegionMcworld(
    { x0: crop.x0, z0: crop.z0, size: crop.size, name: "Synthetic Footprint Test" },
    undefined,
    {
      buildings: placement.placed,
      columnAt: (x, z) => {
        const wet = pointInRects(x, z, water);
        return { groundY: wet ? groundY - 2 : groundY, surfaceY: groundY, wet, meters: 670 };
      },
      roadMarkAt: (x, z) => (pointInRects(x, z, roads) ? 3 : 0),
    },
  );

  const files = unzipSync(built.bytes);
  const level = readNamedCompound(Buffer.from(files["level.dat"]!), 8).value;
  assert.equal(level.SpawnX, built.spawn.x);
  assert.equal(level.SpawnY, built.spawn.y);
  assert.equal(level.SpawnZ, built.spawn.z);
  assert.ok(!pointInRects(built.spawn.x, built.spawn.z, placement.clearances), "spawn must be clear of buildings");

  const root = await mkdtemp(path.join(os.tmpdir(), "cda-footprint-world-"));
  try {
    const dbDir = path.join(root, "db");
    await mkdir(dbDir);
    await Promise.all(
      Object.entries(files)
        .filter(([name]) => name.startsWith("db/"))
        .map(([name, bytes]) => writeFile(path.join(root, name), bytes)),
    );
    const db = await Database.open(dbDir);
    try {
      const readBlockName = (x: number, y: number, z: number): string | undefined => {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const subY = Math.floor(y / 16);
        const raw = db.get(chunkKey(cx, cz, TAG_SUBCHUNK, subY));
        if (!raw) return undefined;
        const decoded = decodeSubchunk(raw, subY);
        const lx = ((x % 16) + 16) % 16;
        const ly = ((y % 16) + 16) % 16;
        const lz = ((z % 16) + 16) % 16;
        return decoded?.get(localIndex(lx, ly, lz) + (y << 16));
      };

      // Road block survived at (-65, groundY, -67).
      assert.equal(readBlockName(-65, groundY, -67), BLOCKS[Block.GrayConcrete].name, "road block must survive");

      // Courtyard negative chunk wall, roof, door, chest, and bed records survived.
      const courtyard = placement.placed.find((b) => b.id === "courtyard-crosses-negative-chunks")!;
      const negBlock = courtyard.blocks.find((b) => Math.floor(b.x / 16) === -2 && Math.floor(b.z / 16) === -2 && b.y > groundY)!;
      assert.equal(readBlockName(negBlock.x, negBlock.y, negBlock.z), BLOCKS[negBlock.block].name, "negative chunk block");

      const door = courtyard.doorCell!;
      assert.equal(readBlockName(door.x, door.y, door.z), "minecraft:oak_door", "door block");

      const roofBlock = courtyard.blocks.reduce((top, b) => (b.y > top.y ? b : top), courtyard.blocks[0]!);
      assert.equal(readBlockName(roofBlock.x, roofBlock.y, roofBlock.z), BLOCKS[roofBlock.block].name, "roof block");

      // Verify block entities (chests & beds) in LevelDB across all placed buildings.
      const allChests = placement.placed.flatMap((b) => b.chests);
      const allBeds = placement.placed.flatMap((b) => b.beds);
      const entityChunks = new Map<string, Buffer>();
      for (const item of [...allChests, ...allBeds]) {
        const cx = Math.floor(item.x / 16);
        const cz = Math.floor(item.z / 16);
        entityChunks.set(`${cx},${cz}`, chunkKey(cx, cz, TAG_BLOCK_ENTITY));
      }
      const tags = [...entityChunks.values()].flatMap((k) => {
        const raw = db.get(k);
        assert.ok(raw, "missing TAG_BLOCK_ENTITY chunk record");
        const list = [];
        for (let offset = 0; offset < raw.length;) {
          const parsed = readNamedCompound(raw, offset);
          list.push(parsed.value);
          offset = parsed.offset;
        }
        return list;
      });
      assert.equal(tags.length, allChests.length + allBeds.length);
      for (const chest of allChests) {
        const tag = tags.find((t) => t.id === "Chest" && t.x === chest.x && t.y === chest.y && t.z === chest.z);
        assert.ok(tag, `missing chest entity at ${chest.x},${chest.y},${chest.z}`);
        assert.equal(tag.CustomName, chest.label);
      }
      for (const bed of allBeds) {
        assert.ok(tags.some((t) => t.id === "Bed" && t.x === bed.x && t.y === bed.y && t.z === bed.z));
      }
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
