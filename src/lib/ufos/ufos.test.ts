import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Database } from "@jsprismarine/leveldb";
import { unzipSync } from "fflate";
import { BLOCKS, Block } from "@/lib/blocks";
import { chunkKey, localIndex, TAG_BLOCK_ENTITY, TAG_DATA_3D, TAG_SUBCHUNK } from "@/lib/chunk";
import { readNamedCompound } from "@/lib/read-nbt";
import { decodeSubchunk } from "@/lib/chunk-mesh";
import { POST } from "@/app/api/ufos/route";
import type { VoxelPosition } from "@/lib/voxels";
import { hullsFor, UFO_CONDITIONS, UFO_HULLS, type UfoCondition, type UfoHull } from "./catalog";
import { generateUfo, type Ufo } from "./generate";
import { asteroidGeology } from "./asteroid-geology";

const key = ({ x, y, z }: VoxelPosition) => `${x},${y},${z}`;

const ASTEROID_ORE = [Block.IronOre, Block.CopperOre, Block.GoldOre, Block.DiamondOre, Block.EmeraldOre, Block.AncientDebris] as const;

function checkAsteroidOre(ufo: Ufo) {
  for (const id of ASTEROID_ORE) assert.ok(ufo.blocks.some(({ block }) => block === id));
  const debris = ufo.blocks.filter(({ block }) => block === Block.AncientDebris);
  assert.ok(debris.length >= 8 && debris.length <= 13);
  const center = debris.filter(({ x, y, z }) => Math.abs(x) <= 8 && Math.abs(z) <= 8 && y >= -9 && y <= 8);
  assert.equal(center.length, 3);
  const separation = (a: VoxelPosition, b: VoxelPosition) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  assert.equal(center.filter((a) => center.some((b) => separation(a, b) === 1)).length, 3);
  for (const piece of debris.filter((piece) => !center.includes(piece))) {
    assert.ok(debris.every((other) => other === piece || separation(piece, other) >= 5));
  }
}

function walkable(ufo: Ufo, start = ufo.spawn) {
  const blocks = new Map(ufo.blocks.map((voxel) => [key(voxel), voxel.block]));
  const solid = (x: number, y: number, z: number) => (blocks.get(key({ x, y, z })) ?? (y < 0 ? Block.Stone : Block.Air)) !== Block.Air;
  const queue = [start];
  const seen = new Set([key(start)]);
  for (const point of queue) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = point.x + dx;
      const z = point.z + dz;
      if (Math.abs(x) > ufo.width / 2 + 3 || Math.abs(z) > Math.max(ufo.length / 2 + 10, ufo.spawn.z + 2)) continue;
      for (const y of [point.y, point.y + 1, point.y - 1]) {
        if (!solid(x, y - 1, z) || solid(x, y, z) || solid(x, y + 1, z)) continue;
        if (y > point.y && solid(point.x, point.y + 2, point.z)) continue;
        if (y < point.y && solid(x, y + 2, z)) continue;
        const next = { x, y, z };
        if (!seen.has(key(next))) {
          seen.add(key(next));
          queue.push(next);
        }
        break;
      }
    }
  }
  return seen;
}

test("every UFO hull and damage state has a walkable deck and a matching cutaway", () => {
  for (const hull of Object.keys(UFO_HULLS) as UfoHull[]) {
    const landed = generateUfo({ hull, condition: "landed", seed: 17 });
    for (const condition of Object.keys(UFO_CONDITIONS) as UfoCondition[]) {
      for (const seed of [17, 0xffffffff]) {
        const ufo = generateUfo({ hull, condition, seed });
        const cells = new Map(ufo.blocks.map((voxel) => [key(voxel), voxel.block]));
        assert.equal(cells.size, ufo.blocks.length);
        assert.equal(cells.get(key(ufo.spawn)), undefined);
        assert.equal(cells.get(key({ ...ufo.spawn, y: -1 })), Block.Grass);
        assert.ok(ufo.decks.every((deck) => deck.cutaway.every((voxel) => cells.get(key(voxel)) === voxel.block)));
        assert.equal(ufo.blocks.some(({ y, block }) => y < 0 && block === Block.Air), condition !== "landed" || ufo.civilization === "blight");
        assert.ok(ufo.chests.length >= 1);
        const traps = ufo.chests.filter((chest) => cells.get(key(chest)) === Block.TrappedChest);
        assert.equal(traps.length, condition === "landed" ? 0 : 1, `${hull}/${condition}/${seed} trap count`);
        assert.equal(ufo.blocks.filter((voxel) => voxel.block === Block.Tnt).length, traps.length);
        assert.ok(traps.every((chest) => cells.get(key({ ...chest, y: chest.y - 1 })) === Block.Tnt));
        for (const chest of ufo.chests) {
          const block = cells.get(key(chest));
          assert.ok(block === Block.Chest || block === Block.TrappedChest);
          assert.equal(chest.items.length, 2);
          assert.ok(chest.items.every(({ count }) => count >= 1 && count <= 5));
        }
        if (condition === "exploded" && seed === 17) {
          const exposedLevels = ufo.civilization === "blight" ? ufo.decks.slice(0, 1) : ufo.decks;
          assert.ok(exposedLevels.every((deck, i) => deck.cutaway.length < landed.decks[i].cutaway.length));
        }

        let walk = walkable(ufo);
        if (ufo.civilization === "blight") {
          checkAsteroidOre(ufo);
          assert.equal(ufo.entrances?.length, 3);
          for (const { outside, inside } of ufo.entrances!) {
            const steps = Math.abs(inside.x - outside.x) + Math.abs(inside.z - outside.z);
            for (let i = 0; i <= steps; i++) {
              const x = outside.x + Math.sign(inside.x - outside.x) * i;
              const z = outside.z + Math.sign(inside.z - outside.z) * i;
              const y = Math.round(outside.y + (inside.y - outside.y) * i / steps);
              const floor = cells.get(key({ x, y: y - 1, z }));
              assert.ok(floor !== undefined && floor !== Block.Air);
              for (const height of [y, y + 1]) {
                const block = cells.get(key({ x, y: height, z }));
                assert.ok(block === undefined || block === Block.Air, `Blocked asteroid entrance at ${x},${height},${z}`);
              }
            }
            assert.ok(outside.y >= 8, "asteroid entrance is above ground");
            const fromLedge = walkable(ufo, outside);
            assert.ok(fromLedge.has(key(inside)), `${hull}/${condition}/${seed} blocked ledge ${JSON.stringify(outside)}`);
            for (const deck of ufo.decks) {
              assert.ok(deck.rooms.some(({ entry }) => fromLedge.has(key(entry))), `${hull}/${condition}/${seed} ledge cannot reach ${deck.name}`);
            }
          }
          walk = walkable(ufo, ufo.entrances![0].outside);
        }
        for (const trap of traps) {
          const { x, y, z } = trap;
          assert.ok([-1, 0, 1].some((dy) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
            walk.has(key({ x: x + dx, y: y + dy, z: z + dz })))), `${hull}/${condition}/${seed} trap is inaccessible`);
        }
        for (const deck of ufo.decks) {
          const accessible = deck.rooms.filter(({ entry }) => walk.has(key(entry)));
          assert.ok(accessible.length >= 2, `${hull}/${condition}/${seed} cannot reach ${deck.name}`);
          if (condition === "landed") {
            assert.deepEqual(accessible.map((room) => room.name), deck.rooms.map((room) => room.name), `${hull}/${seed} ${deck.name}`);
          }
        }
      }
    }
  }
});

test("seeds vary the room boundaries and mix of uses within one hull", () => {
  const layouts = Array.from({ length: 6 }, (_, seed) => generateUfo({ hull: "shrike", condition: "landed", seed }).decks);
  const bounds = (decks: Ufo["decks"]) => decks.map((deck) => deck.rooms.map(({ x0, x1, z0, z1 }) => [x0, x1, z0, z1]));
  assert.equal(new Set(layouts.map((decks) => JSON.stringify(bounds(decks)))).size, layouts.length);
  assert.ok(new Set(layouts.map((decks) => decks.map((deck) => deck.rooms.length).join(","))).size > 1);
});

test("asteroid cavern loops vary with seed and contain carved air below ground", () => {
  const asteroid = generateUfo({ civilization: "blight", hull: "hiveCluster", condition: "impact", seed: 2 });
  const other = generateUfo({ civilization: "blight", hull: "hiveCluster", condition: "impact", seed: 3 });
  assert.deepEqual(asteroid.decks.map((deck) => deck.name), ["Crown", "Outer tunnels", "Feeder galleries", "Deep core"]);
  assert.notDeepEqual(asteroid.decks.map((deck) => deck.rooms), other.decks.map((deck) => deck.rooms));
  assert.notDeepEqual(
    asteroid.blocks.filter(({ block }) => block === Block.AncientDebris),
    other.blocks.filter(({ block }) => block === Block.AncientDebris),
  );
  const cells = new Map(asteroid.blocks.map((voxel) => [key(voxel), voxel.block]));
  for (const room of asteroid.decks.at(-1)!.rooms) {
    assert.ok(room.entry.y < -3);
    assert.equal(cells.get(key(room.entry)), Block.Air);
  }
});

test("Blight geology cuts a bowl into the rock and raises a rim around a satellite crater", () => {
  const geology = asteroidGeology({ hull: "seedstone", condition: "landed", rx: 25, rz: 26, height: 23, lobes: 1, phase: 0, outerY: 2 }, () => 0.5);
  const x = 11;
  const z = 12;
  const summit = (x: number, z: number) => {
    const column = geology.rockColumn(x, z);
    return Array.from({ length: 30 }, (_, i) => 38 - i).find((y) => column(y) !== undefined) ?? 0;
  };
  assert.ok(summit(x, z) + 2 < summit(x - 7, z));
  assert.ok(summit(x, z) < summit(x + 5, z - 4));

  const satX = 37;
  const satZ = 16;
  assert.ok(geology.groundAt(satX, satZ).y <= -4);
  assert.ok(geology.groundAt(satX + 7, satZ).y >= 0);
});

test("Blight impacts produce distinct terrain and silhouettes for the same seed", () => {
  const sample = (condition: UfoCondition) => asteroidGeology({
    hull: "seedstone", condition, rx: 25, rz: 26, height: 23, lobes: 1, phase: 0, outerY: condition === "impact" ? -1 : 2,
  }, () => 0.5);
  const intact = sample("landed");
  const buried = sample("impact");
  const skid = sample("skid");
  const shattered = sample("exploded");
  const cap = (site: ReturnType<typeof sample>, x: number, z: number) => {
    const column = site.rockColumn(x, z);
    return Array.from({ length: 45 }, (_, i) => 40 - i).find((y) => column(y) !== undefined) ?? -5;
  };
  assert.ok(cap(intact, 0, 0) - cap(buried, 0, 0) >= 10);
  assert.ok(skid.groundAt(-10, -45).y < intact.groundAt(-10, -45).y - 2);
  assert.ok(cap(intact, 16, 0) - cap(shattered, 16, 0) >= 10);
});

test("larger landed ships carry more caches drawn from the same modest loot pool", () => {
  const small = generateUfo({ hull: "saucer", condition: "landed", seed: 17 });
  const large = generateUfo({ hull: "carrier", condition: "landed", seed: 17 });
  assert.ok(large.chests.length > small.chests.length);
  for (const ufo of [small, large]) {
    assert.ok(ufo.chests.every(({ items }) => items.every(({ name }) =>
      /:(torch|bread|baked_potato|charcoal|copper_ingot|iron_ingot|string|glass_pane)$/.test(name))));
  }
});

test("a random selection is reproducible using the resolved hull, condition and seed", () => {
  const classic = generateUfo({ seed: 0 });
  assert.deepEqual(generateUfo({ hull: classic.hull, condition: classic.condition, seed: classic.seed }), classic);
  assert.equal(classic.civilization, "classic");

  const xenos = generateUfo({ civilization: "xenos", seed: 0 });
  assert.ok(hullsFor("xenos").includes(xenos.hull));
  assert.deepEqual(generateUfo({ hull: xenos.hull, condition: xenos.condition, seed: xenos.seed }), xenos);

  const blight = generateUfo({ civilization: "blight", seed: 19 });
  assert.ok(hullsFor("blight").includes(blight.hull));
  assert.deepEqual(generateUfo({ hull: blight.hull, condition: blight.condition, seed: blight.seed }), blight);
});

test("the export route preserves sub-surface crater blocks and rejects invalid configurations", async () => {
  const request = (body: unknown) => new Request("http://localhost/api/ufos", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await POST(request({ hull: "toString" }))).status, 400);
  assert.equal((await POST(request({ seed: -1 }))).status, 400);
  assert.equal((await POST(request({ civilization: "xenos", hull: "saucer" }))).status, 400);

  const xenos = await POST(request({ civilization: "xenos", hull: "maw", condition: "impact", seed: 17 }));
  assert.equal(xenos.status, 200);
  assert.match(xenos.headers.get("content-disposition") ?? "", /ufo-maw-impact-17\.mcworld/);

  const options = { hull: "saucer", condition: "exploded", seed: 71342 } as const;
  const response = await POST(request(options));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /ufo-saucer-exploded-71342\.mcworld/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.ok(files["level.dat"]);
  const ufo = generateUfo(options);
  assert.equal(readNamedCompound(Buffer.from(files["level.dat"]), 8).value.tntexplodes, 1);
  const crater = ufo.blocks.find((voxel) => voxel.x > ufo.width * 0.40 && voxel.y === -1 && voxel.block === Block.Air &&
    !ufo.blocks.some((other) => other.x === voxel.x && other.z === voxel.z && other.y >= 0));
  assert.ok(crater);
  const { x, z } = crater;
  const floor = ufo.blocks
    .filter((voxel) => voxel.x === x && voxel.z === z && voxel.y < -1 && voxel.block !== Block.Air)
    .sort((a, b) => b.y - a.y)[0];
  assert.ok(floor);
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);

  const directory = await mkdtemp(path.join(tmpdir(), "spawnwright-ufo-test-"));
  try {
    const dbDir = path.join(directory, "db");
    await mkdir(dbDir);
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith("db/")) await writeFile(path.join(directory, name), bytes);
    }
    const db = await Database.open(dbDir);
    try {
      const section = db.get(chunkKey(chunkX, chunkZ, TAG_SUBCHUNK, -1));
      assert.ok(section);
      const decoded = decodeSubchunk(Buffer.from(section), -1);
      assert.equal(decoded?.get(localIndex(x, -1, z) + (-1 << 16)), undefined);
      assert.equal(decoded?.get(localIndex(x, floor.y, z) + (floor.y << 16)), BLOCKS[floor.block].name);
      const heightmap = db.get(chunkKey(chunkX, chunkZ, TAG_DATA_3D));
      assert.ok(heightmap);
      assert.equal(Buffer.from(heightmap).readInt16LE(2 * ((z & 15) * 16 + (x & 15))), floor.y + 1);

      const chest = ufo.chests.find((chest) =>
        ufo.blocks.some((voxel) => key(voxel) === key(chest) && voxel.block === Block.TrappedChest));
      assert.ok(chest);
      const cx = Math.floor(chest.x / 16);
      const cz = Math.floor(chest.z / 16);
      for (const [y, name] of [[chest.y, "minecraft:trapped_chest"], [chest.y - 1, "minecraft:tnt"]] as const) {
        const subY = Math.floor(y / 16);
        const voxels = db.get(chunkKey(cx, cz, TAG_SUBCHUNK, subY));
        assert.ok(voxels);
        assert.equal(
          decodeSubchunk(Buffer.from(voxels), subY)?.get(localIndex(chest.x, y, chest.z) + (y << 16)),
          name,
        );
      }
      const tags = db.get(chunkKey(cx, cz, TAG_BLOCK_ENTITY));
      assert.ok(tags);
      let loot;
      for (let offset = 0; offset < tags.length;) {
        const { value, offset: next } = readNamedCompound(Buffer.from(tags), offset);
        if (value.x === chest.x && value.y === chest.y && value.z === chest.z) loot = value;
        offset = next;
      }
      assert.equal(loot?.id, "Chest");
      assert.deepEqual((loot?.Items as { Name: string; Count: number }[]).map(({ Name, Count }) => ({ name: Name, count: Count })), chest.items);

      const upper = ufo.decks[1].cutaway.find((voxel) => voxel.y >= 5 && Math.abs(voxel.x) > 4);
      assert.ok(upper);
      const upperSubY = Math.floor(upper.y / 16);
      const upperSection = db.get(chunkKey(Math.floor(upper.x / 16), Math.floor(upper.z / 16), TAG_SUBCHUNK, upperSubY));
      assert.ok(upperSection);
      assert.equal(
        decodeSubchunk(Buffer.from(upperSection), upperSubY)?.get(localIndex(upper.x, upper.y, upper.z) + (upper.y << 16)),
        BLOCKS[upper.block].name,
      );
    } finally {
      await db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("a Blight export stores playable air and a cave floor below the meteorite", async () => {
  const options = { civilization: "blight", hull: "seedstone", condition: "impact", seed: 31 } as const;
  const response = await POST(new Request("http://localhost/api/ufos", { method: "POST", body: JSON.stringify(options) }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /seedstone-impact-31\.mcworld/);
  const asteroid = generateUfo(options);
  const { x, y, z } = asteroid.decks.at(-1)!.rooms[0].entry;
  assert.ok(y < -3);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const root = await mkdtemp(path.join(tmpdir(), "spawnwright-blight-test-"));
  try {
    const dbDir = path.join(root, "db");
    await mkdir(dbDir);
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith("db/")) await writeFile(path.join(root, name), bytes);
    }
    const db = await Database.open(dbDir);
    try {
      const subY = Math.floor(y / 16);
      const section = db.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16), TAG_SUBCHUNK, subY));
      assert.ok(section);
      const decoded = decodeSubchunk(Buffer.from(section), subY);
      assert.ok(decoded);
      assert.equal(decoded.get(localIndex(x, y, z) + (y << 16)), undefined);
      for (const ore of ASTEROID_ORE) {
        const voxel = asteroid.blocks.find(({ block }) => block === ore);
        assert.ok(voxel);
        const sectionY = Math.floor(voxel.y / 16);
        const oreSection = db.get(chunkKey(Math.floor(voxel.x / 16), Math.floor(voxel.z / 16), TAG_SUBCHUNK, sectionY));
        assert.ok(oreSection);
        assert.equal(
          decodeSubchunk(Buffer.from(oreSection), sectionY)?.get(localIndex(voxel.x, voxel.y, voxel.z) + (voxel.y << 16)),
          BLOCKS[ore].name,
        );
      }
      const floorY = y - 1;
      const floorSubY = Math.floor(floorY / 16);
      const floorSection = db.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16), TAG_SUBCHUNK, floorSubY));
      assert.ok(floorSection);
      assert.ok(decodeSubchunk(Buffer.from(floorSection), floorSubY)?.get(localIndex(x, floorY, z) + (floorY << 16)));
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
