import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database, WriteBatch } from "@jsprismarine/leveldb";
import { zipSync } from "fflate";
import { Block, type BlockId } from "@/lib/blocks";
import {
  CHUNK_VERSION,
  MAX_SUBCHUNK,
  MIN_SUBCHUNK,
  TAG_BLOCK_ENTITY,
  TAG_DATA_3D,
  TAG_FINALIZED,
  TAG_SUBCHUNK,
  TAG_VERSION,
  chunkKey,
  encodeData3D,
  encodeSubChunk,
  fillSubChunk,
} from "@/lib/chunk";
import { levelDat } from "@/lib/inw/region-world";
import { byte, compound, int, list, short, str, writeRoot } from "@/lib/nbt";
import type { Voxel, VoxelPosition } from "@/lib/voxels";

type WorldChest = VoxelPosition & { label: string; items: { name: string; count: number }[] };
type VoxelWorld = {
  title: string;
  seed: number;
  spawn: VoxelPosition;
  blocks: readonly Voxel[];
  chests?: readonly WorldChest[];
  beds?: readonly VoxelPosition[];
};

function chestTag(chest: WorldChest): Buffer {
  return writeRoot({
    id: str("Chest"),
    isMovable: byte(1),
    Findable: byte(0),
    CustomName: str(chest.label),
    x: int(chest.x),
    y: int(chest.y),
    z: int(chest.z),
    Items: list(
      "compound",
      chest.items.slice(0, 27).map((item, slot) =>
        compound({
          Name: str(item.name),
          Damage: short(0),
          Count: byte(Math.max(1, Math.min(64, item.count))),
          Slot: byte(slot),
        }),
      ),
    ),
  });
}

function bedTag(bed: VoxelPosition): Buffer {
  return writeRoot({
    id: str("Bed"),
    isMovable: byte(1),
    color: byte(14),
    x: int(bed.x),
    y: int(bed.y),
    z: int(bed.z),
  });
}

export async function packVoxelWorld(world: VoxelWorld): Promise<Uint8Array> {
  const occupied = new Map<string, BlockId>();
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  let minY = -1;
  let maxY = 4;
  let tntExplodes = false;
  for (const block of world.blocks) {
    occupied.set(`${block.x},${block.y},${block.z}`, block.block);
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x);
    minZ = Math.min(minZ, block.z);
    maxZ = Math.max(maxZ, block.z);
    minY = Math.min(minY, block.y);
    maxY = Math.max(maxY, block.y);
    tntExplodes ||= block.block === Block.Tnt;
  }
  const chunkX0 = Math.floor((minX - 4) / 16);
  const chunkX1 = Math.floor((maxX + 4) / 16);
  const chunkZ0 = Math.floor((minZ - 4) / 16);
  const chunkZ1 = Math.floor((maxZ + 4) / 16);
  const entities = new Map<string, Buffer[]>();
  const addEntity = (x: number, z: number, tag: Buffer) => {
    const id = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
    if (!entities.has(id)) entities.set(id, []);
    entities.get(id)!.push(tag);
  };
  for (const chest of world.chests ?? []) addEntity(chest.x, chest.z, chestTag(chest));
  for (const bed of world.beds ?? []) addEntity(bed.x, bed.z, bedTag(bed));

  const blockAt = (x: number, y: number, z: number) => occupied.get(`${x},${y},${z}`)
    ?? (y === -1 ? Block.Grass : y >= -4 && y < -1 ? Block.Dirt : y > -64 && y < -4 ? Block.Stone : y === -64 ? Block.Bedrock : Block.Air);

  const root = await mkdtemp(path.join(os.tmpdir(), "spawnwright-world-"));
  const dbDir = path.join(root, "db");
  await mkdir(dbDir);
  try {
    const db = await Database.open(dbDir);
    try {
      const batch = new WriteBatch();
      const version = Buffer.from([CHUNK_VERSION]);
      const finalized = Buffer.alloc(4);
      finalized.writeInt32LE(2, 0);
      const section = new Uint16Array(4096);
      const maxSub = Math.min(MAX_SUBCHUNK, Math.floor(maxY / 16));
      for (let chunkZ = chunkZ0; chunkZ <= chunkZ1; chunkZ += 1) {
        for (let chunkX = chunkX0; chunkX <= chunkX1; chunkX += 1) {
          const heightmap = new Uint16Array(256);
          for (let lz = 0; lz < 16; lz += 1) {
            for (let lx = 0; lx < 16; lx += 1) {
              let top = -64;
              for (let y = maxY; y >= Math.max(-64, minY - 1); y -= 1) {
                const block = blockAt(chunkX * 16 + lx, y, chunkZ * 16 + lz);
                if (block !== Block.Air) {
                  top = y;
                  break;
                }
              }
              heightmap[lz * 16 + lx] = top + 1;
            }
          }
          batch.put(chunkKey(chunkX, chunkZ, TAG_VERSION), version);
          batch.put(chunkKey(chunkX, chunkZ, TAG_FINALIZED), finalized);
          batch.put(chunkKey(chunkX, chunkZ, TAG_DATA_3D), encodeData3D(heightmap, 1));
          for (let subY = MIN_SUBCHUNK; subY <= maxSub; subY += 1) {
            fillSubChunk(section, subY, (lx, y, lz) => blockAt(chunkX * 16 + lx, y, chunkZ * 16 + lz));
            const encoded = encodeSubChunk(section, subY);
            if (encoded) batch.put(chunkKey(chunkX, chunkZ, TAG_SUBCHUNK, subY), encoded);
          }
          const here = entities.get(`${chunkX},${chunkZ}`);
          if (here && here.length > 0) {
            batch.put(chunkKey(chunkX, chunkZ, TAG_BLOCK_ENTITY), Buffer.concat(here));
          }
        }
      }
      db.write(batch);
    } finally {
      await db.close();
    }

    const files: Record<string, Uint8Array> = {
      "level.dat": levelDat(world.title.slice(0, 60), world.spawn, BigInt(world.seed), 59, tntExplodes),
      "levelname.txt": Buffer.from(`${world.title}\n`, "utf8"),
      "world_behavior_packs.json": Buffer.from("[]"),
      "world_resource_packs.json": Buffer.from("[]"),
    };
    files["level.dat_old"] = files["level.dat"];
    for (const name of await readdir(dbDir)) {
      if (name === "LOCK") continue;
      files[`db/${name}`] = await readFile(path.join(dbDir, name));
    }
    return zipSync(files, { level: 6 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
