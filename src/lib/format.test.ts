import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Database } from "@jsprismarine/leveldb";
import { unzipSync } from "fflate";
import { Block, blockLabel } from "@/lib/blocks";
import {
  CHUNK_VERSION,
  TAG_DATA_3D,
  TAG_SUBCHUNK,
  TAG_VERSION,
  chunkKey,
  encodeData3D,
  encodeSubChunk,
  localIndex,
} from "@/lib/chunk";
import { int, writeRoot } from "@/lib/nbt";
import { buildLevelDat, buildMcworld } from "@/lib/mcworld";
import { DEFAULT_SETTINGS, parseSettings, SettingsError } from "@/lib/settings";
import { BASE_Y, blockAt, blockCensus, generateWorld } from "@/lib/terrain";

test("little-endian NBT writes a named integer", () => {
  const encoded = writeRoot({ A: int(42) });
  assert.deepEqual(
    [...encoded],
    [0x0a, 0x00, 0x00, 0x03, 0x01, 0x00, 0x41, 0x2a, 0x00, 0x00, 0x00, 0x00],
  );
});

test("subchunk index packs Y fastest and keeps a single stone", () => {
  assert.equal(localIndex(1, 3, 2), 291);
  const blocks = new Uint16Array(4096);
  blocks[291] = Block.Stone;
  const encoded = encodeSubChunk(blocks, -4);
  assert.ok(encoded);
  assert.equal(encoded[0], 9);
  assert.equal(encoded[1], 1);
  assert.equal(encoded.readInt8(2), -4);
  assert.equal(encoded[3] >> 1, 1);
  const word9 = encoded.readUInt32LE(4 + 9 * 4);
  assert.equal((word9 >> 3) & 1, 1);
  assert.match(encoded.toString("utf8"), /minecraft:stone/);
  assert.match(encoded.toString("utf8"), /minecraft:air/);
});

test("uniform subchunks omit the index words", () => {
  const blocks = new Uint16Array(4096).fill(Block.Stone);
  const encoded = encodeSubChunk(blocks, 0);
  assert.ok(encoded);
  assert.equal(encoded[3], 0);
  assert.match(encoded.subarray(4).toString("utf8"), /minecraft:stone/);
});

test("empty subchunks are left out", () => {
  assert.equal(encodeSubChunk(new Uint16Array(4096), 3), null);
});

test("data3d biome palette is 24 single-value sections", () => {
  const height = new Uint16Array(256).fill(65);
  const encoded = encodeData3D(height, 4);
  assert.equal(encoded.length, 512 + 24 * 5);
  assert.equal(encoded.readUInt16LE(0), 65);
  for (let section = 0; section < 24; section += 1) {
    const offset = 512 + section * 5;
    assert.equal(encoded[offset], 0x01);
    assert.equal(encoded.readInt32LE(offset + 1), 4);
  }
});

test("settings reject a blank name and an unknown world type", () => {
  assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, name: "  " }), SettingsError);
  assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, theme: "nether" }), SettingsError);
  const parsed = parseSettings({ ...DEFAULT_SETTINGS, seed: "42" } as unknown);
  assert.equal(parsed.seed, 42);
});

test("drafts meet the flat grass outside the map", () => {
  for (const theme of ["pine-camp", "cove", "mesa", "snowfield", "festival"] as const) {
    const world = generateWorld({ ...DEFAULT_SETTINGS, theme, size: "intimate", seed: 7 });
    for (let i = 0; i < world.size; i += 1) {
      for (const [x, z] of [
        [0, i],
        [world.size - 1, i],
        [i, 0],
        [i, world.size - 1],
      ] as const) {
        const cell = z * world.size + x;
        assert.equal(world.heights[cell], BASE_Y, theme);
        assert.equal(world.surface[cell], Block.Grass, theme);
        assert.equal(world.waterTop[cell], -1, theme);
      }
    }
    assert.equal(blockAt(world, world.spawn.x, world.spawn.y, world.spawn.z), Block.Air);
    assert.notEqual(blockAt(world, world.spawn.x, world.spawn.y - 1, world.spawn.z), Block.Air);
    assert.equal(blockAt(world, 0, -64, 4), Block.Bedrock);
    assert.equal(blockAt(world, 0, 0, 4), Block.Stone);
    assert.equal(blockAt(world, 0, 62, 4), Block.Dirt);
    assert.equal(blockAt(world, 0, 64, 4), Block.Grass);
  }
});

test("the overlook can name the blocks it draws", () => {
  const world = generateWorld({ ...DEFAULT_SETTINGS, theme: "pine-camp", size: "intimate", seed: 7 });
  const names = blockCensus(world).map((entry) => blockLabel(entry.id));
  assert.ok(names.includes("Grass"));
  assert.ok(names.includes("Spruce log"));
  assert.ok(names.includes("Campfire"));
  assert.equal(blockLabel(Block.Water), "Water");
});

test("the same seed drafts the same land", () => {
  const a = generateWorld(DEFAULT_SETTINGS);
  const b = generateWorld(DEFAULT_SETTINGS);
  assert.deepEqual(a.heights, b.heights);
  assert.deepEqual(a.surface, b.surface);
  assert.equal(a.spawn.x, b.spawn.x);
});

test("the cove holds water inside a sand rim", () => {
  const world = generateWorld({ ...DEFAULT_SETTINGS, theme: "cove", size: "weekend", seed: 99 });
  let water = 0;
  for (let i = 0; i < world.waterTop.length; i += 1) if (world.waterTop[i] >= 0) water += 1;
  assert.ok(water > 20);
  const wet = world.waterTop.findIndex((value) => value >= 58);
  const x = wet % world.size;
  const z = Math.floor(wet / world.size);
  assert.equal(blockAt(world, x, world.waterTop[wet], z), Block.Water);
});

test("a packed world round-trips through Bedrock LevelDB", async () => {
  const settings = { ...DEFAULT_SETTINGS, name: "Round Trip", size: "intimate" as const, seed: 11 };
  const packed = await buildMcworld(settings);
  const files = unzipSync(packed);
  assert.ok(files["level.dat"]);
  assert.equal(Buffer.from(files["levelname.txt"]).toString("utf8"), "Round Trip\n");
  assert.ok(files["world_icon.jpeg"][0] === 0xff);
  assert.ok(Object.keys(files).some((name) => name.startsWith("db/") && name !== "db/LOCK"));

  const level = buildLevelDat(generateWorld(settings));
  assert.equal(level.readInt32LE(0), 10);
  assert.equal(level.readInt32LE(4), level.length - 8);
  assert.ok(level.includes(Buffer.from("Round Trip")));

  const root = await mkdtemp(path.join(os.tmpdir(), "spawnwright-read-"));
  try {
    const dbDir = path.join(root, "db");
    await mkdir(dbDir);
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.startsWith("db/")) continue;
      await writeFile(path.join(root, name), bytes);
    }
    const db = await Database.open(dbDir);
    try {
      const version = db.get(chunkKey(0, 0, TAG_VERSION));
      assert.ok(version);
      assert.equal(version[0], CHUNK_VERSION);
      const biomes = db.get(chunkKey(0, 0, TAG_DATA_3D));
      assert.ok(biomes);
      assert.equal(biomes.length, 512 + 24 * 5);
      const sub = db.get(chunkKey(0, 0, TAG_SUBCHUNK, -4));
      assert.ok(sub);
      assert.match(Buffer.from(sub).toString("utf8"), /minecraft:bedrock/);
      const surface = db.get(chunkKey(0, 0, TAG_SUBCHUNK, 4));
      assert.ok(surface);
      assert.match(Buffer.from(surface).toString("utf8"), /minecraft:grass_block/);
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
