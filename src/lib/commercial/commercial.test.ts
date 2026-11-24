import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Database } from "@jsprismarine/leveldb";
import { unzipSync } from "fflate";
import { Block } from "@/lib/blocks";
import { chunkKey, TAG_BLOCK_ENTITY } from "@/lib/chunk";
import { readNamedCompound } from "@/lib/read-nbt";
import { generateCommercialBatch } from "./batch";
import { COMMERCIAL_TYPES, TYPE_SCALES } from "./catalog";
import { generateCommercial } from "./generate";
import { packCommercial } from "./pack";

test("every compatible commercial type and scale generates valid blocks, chests, and clear spawn", () => {
  for (const [type, scales] of Object.entries(TYPE_SCALES) as [
    keyof typeof TYPE_SCALES,
    (typeof TYPE_SCALES)[keyof typeof TYPE_SCALES],
  ][]) {
    for (const scale of scales) {
      for (const seed of [0, 17, 40317, 0xffffffff]) {
        const building = generateCommercial({ type, scale, seed });
        assert.equal(building.type, type);
        assert.equal(building.scale, scale);

        const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
        const cells = new Map(building.blocks.map(({ x, y, z, block }) => [key(x, y, z), block]));
        assert.equal(cells.size, building.blocks.length);

        // Clear spawn standing on solid ground
        assert.ok(cells.has(key(building.spawn.x, -1, building.spawn.z)));
        assert.ok(!cells.has(key(building.spawn.x, 0, building.spawn.z)));
        assert.ok(!cells.has(key(building.spawn.x, 1, building.spawn.z)));

        // Every chest is placed in the voxel map with open headroom (or a stacked chest) and non-empty loot
        assert.ok(building.chests.length > 0, `${type} ${scale} seed ${seed} should have stocked chests`);
        for (const chest of building.chests) {
          assert.equal(cells.get(key(chest.x, chest.y, chest.z)), Block.Chest);
          const above = cells.get(key(chest.x, chest.y + 1, chest.z));
          assert.ok(
            above === undefined || above === Block.Chest,
            `${type} ${scale} seed ${seed}: chest at (${chest.x},${chest.y},${chest.z}) blocked above by ${above}`,
          );
          assert.ok(chest.items.length > 0);
        }

        // Ground-floor circulation spans all volumes
        assert.equal(building.plan.connections.length, building.plan.volumes.length - 1);
        assert.ok(building.floors.length >= 1);
        for (const floor of building.floors) {
          assert.ok(floor.rooms.length > 0);
        }
      }
    }
  }
});

test("commercial seeds reproduce the preview, respect material overrides, and sample the full CdA mix", () => {
  const rolled = generateCommercial({ seed: 40317 });
  assert.deepEqual(generateCommercial(rolled.request), rolled);
  assert.notDeepEqual(generateCommercial({ seed: 40318 }).blocks, rolled.blocks);

  const custom = generateCommercial({
    type: "sherman_storefront",
    era: "historic",
    scale: "medium",
    seed: 40317,
    materials: { wall: Block.Sandstone, trim: Block.BlackConcrete },
  });
  assert.equal(custom.materials.wall, Block.Sandstone);
  assert.equal(custom.materials.trim, Block.BlackConcrete);

  const types = new Set(Array.from({ length: 80 }, (_, seed) => generateCommercial({ seed }).type));
  assert.deepEqual(
    [...types].sort(),
    Object.keys(COMMERCIAL_TYPES)
      .filter((t) => t !== "any")
      .sort(),
  );
});

test("commercial batch generator produces 6 distinct seeds", () => {
  const batch = generateCommercialBatch({ type: "any", era: "any", scale: "any", seed: 40317 }, 6);
  assert.equal(batch.length, 6);
  assert.equal(new Set(batch.map((b) => b.seed)).size, 6);
});

test("all four store types stock matching front and backroom chests, uniform white outline, and breakrooms", () => {
  for (const storeType of ["grocery", "clothing", "hardware", "pharmacy"] as const) {
    const b = generateCommercial({
      type: "sherman_storefront",
      storeType,
      era: "historic",
      scale: "medium",
      seed: 40317,
    });
    assert.equal(b.storeType, storeType);
    assert.equal(b.materials.trim, Block.WhiteConcrete);

    // Uniform exterior outline on the first-story cornice band along the main envelope's back wall
    const main = b.plan.envelopes[0]!;
    const cells = new Map(b.blocks.map(({ x, y, z, block }) => [`${x},${y},${z}`, block]));
    const corniceY = b.plan.storyHeight - 1;
    for (let x = main.x; x < main.x + main.w; x++) {
      assert.equal(
        cells.get(`${x},${corniceY},${main.z}`),
        Block.WhiteConcrete,
        `outline broken at (${x},${corniceY},${main.z})`,
      );
    }

    // Front aisle chests and hanging aisle signs present
    assert.ok(b.chests.some((c) => c.label === "Front aisle"));
    assert.ok(b.blocks.some((blk) => blk.block === Block.HangingSign));
    assert.ok(b.blocks.some((blk) => blk.block === Block.OakStairEast));

    if (storeType === "clothing") {
      // Clothing store uses back section for changing rooms with 2-high stone brick walls, curtain banners, and armor stands
      assert.ok(b.blocks.some((blk) => blk.block === Block.ArmorStand));
      assert.ok(b.blocks.some((blk) => blk.block === Block.StoneBrickWall));
      assert.ok(b.blocks.some((blk) => blk.block === Block.CurtainBanner));
      assert.ok(!b.chests.some((c) => c.label === "Backroom stock"));
      assert.ok(!b.chests.some((c) => c.label === "Employee breakroom"));
    } else {
      // Non-clothing stores have backroom stock + 2nd-story employee breakroom
      assert.ok(b.chests.some((c) => c.label === "Backroom stock"));
      assert.ok(b.chests.some((c) => c.label === "Employee breakroom"));
    }
  }
});

test("industrial warehouse rolls all three local Coeur d’Alene industrial archetypes", () => {
  const styles = new Set<string>();
  for (let seed = 0; seed < 40; seed++) {
    const b = generateCommercial({ type: "warehouse", scale: "medium", seed });
    if (b.plan.industrialStyle) styles.add(b.plan.industrialStyle);
    assert.equal(b.plan.envelopes.length, 1, "warehouse should be one unified envelope");
  }
  assert.deepEqual([...styles].sort(), ["contractor_shop", "showroom_warehouse", "tiltup_distribution"]);
});

test("commercial Bedrock archive round-trips spawn and named chest inventories", async () => {
  const building = generateCommercial({
    type: "office_midrise",
    era: "contemporary",
    scale: "large",
    seed: 40317,
  });
  const files = unzipSync(await packCommercial(building));
  const level = readNamedCompound(Buffer.from(files["level.dat"]), 8).value;
  assert.equal(level.SpawnX, building.spawn.x);
  assert.equal(level.SpawnY, building.spawn.y);
  assert.equal(level.SpawnZ, building.spawn.z);

  const dir = await mkdtemp(path.join(tmpdir(), "inw-commercial-test-"));
  try {
    const dbDir = path.join(dir, "db");
    await mkdir(dbDir);
    for (const [name, data] of Object.entries(files)) {
      if (name.startsWith("db/")) {
        await writeFile(path.join(dbDir, name.slice(3)), data);
      }
    }
    const db = await Database.open(dbDir);
    try {
      const chunksWithChests = new Set(
        building.chests.map((c) => `${Math.floor(c.x / 16)},${Math.floor(c.z / 16)}`),
      );
      const tags: Record<string, unknown>[] = [];
      for (const chunkId of chunksWithChests) {
        const [cx, cz] = chunkId.split(",").map(Number);
        const raw = db.get(chunkKey(cx, cz, TAG_BLOCK_ENTITY));
        assert.ok(raw, `missing block entities in chunk ${chunkId}`);
        for (let offset = 0; offset < raw.length;) {
          const parsed = readNamedCompound(raw, offset);
          tags.push(parsed.value);
          offset = parsed.offset;
        }
      }
      assert.equal(tags.filter((t) => t.id === "Chest").length, building.chests.length);
      for (const chest of building.chests) {
        const tag = tags.find(
          (t) => t.id === "Chest" && t.x === chest.x && t.y === chest.y && t.z === chest.z,
        );
        assert.ok(tag);
        assert.equal(tag.CustomName, chest.label);
        assert.deepEqual(
          tag.Items,
          chest.items.map((item, Slot) => ({ Name: item.name, Damage: 0, Count: item.count, Slot })),
        );
      }
    } finally {
      await db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
