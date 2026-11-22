/**
 * Turn a rectangular cut of the Inland Northwest height layers into a Bedrock .mcworld.
 * Block x/z match the map. Height uses the same minecraftY curve as the readout.
 * Columns are a shell (bedrock floor, then FILL_DEPTH of stone under the surface) so a
 * kilometre square stays a workable file instead of solid fill through the whole build limit.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database, WriteBatch } from "@jsprismarine/leveldb";
import { zipSync } from "fflate";
import jpeg from "jpeg-js";
import { Block, BLOCKS, type BlockId } from "@/lib/blocks";
import {
  CHUNK_VERSION,
  MAX_SUBCHUNK,
  MIN_SUBCHUNK,
  TAG_DATA_3D,
  TAG_FINALIZED,
  TAG_SUBCHUNK,
  TAG_VERSION,
  chunkKey,
  encodeData3D,
  encodeSubChunk,
  fillSubChunk,
  localIndex,
} from "@/lib/chunk";
import { groundCover } from "@/lib/inw/ground";
import { decodeRoads, rasterRoads, type Road } from "@/lib/inw/roads";
import { NODATA, WORLD } from "@/lib/inw/grid";
import { HEIGHT, minecraftY } from "@/lib/inw/height";
import {
  BIOME_PLAINS,
  FILL_DEPTH,
  alignRegion,
  exportFileName,
  type RegionProgress,
  type RegionSpec,
} from "@/lib/inw/region";
import { WORLD_DIR, readTile } from "@/lib/inw/store";
import { byte, compound, float, int, intList, long, str, writeRoot } from "@/lib/nbt";

export { BIOME_PLAINS, FILL_DEPTH, MAX_API_SIZE, SIZE_CHOICES, exportFileName, type RegionProgress, type RegionSpec } from "@/lib/inw/region";

type Column = { groundY: number; surfaceY: number; wet: boolean; meters: number };

const SIZE = WORLD.tileSize;

class ViewCache {
  private cache = new Map<string, { ground: Int16Array; surface: Int16Array } | null>();

  async load(tx: number, tz: number) {
    const key = `${tx},${tz}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const planes = await readTile("view", 0, tx, tz, 3);
    const value = planes ? { ground: planes[0], surface: planes[1] } : null;
    this.cache.set(key, value);
    if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  async column(x: number, z: number): Promise<Column | null> {
    const tx = Math.floor(x / SIZE);
    const tz = Math.floor(z / SIZE);
    const tile = await this.load(tx, tz);
    if (!tile) return null;
    const i = (z - tz * SIZE) * SIZE + (x - tx * SIZE);
    const groundDm = tile.ground[i];
    if (groundDm === NODATA) return null;
    const meters = groundDm / 10;
    const groundY = minecraftY(meters);
    const surfaceDm = tile.surface[i];
    const wet = surfaceDm !== NODATA;
    // Keep at least one water block even when bed and pool round to the same Minecraft y.
    const surfaceY = wet ? Math.max(groundY + 1, minecraftY(surfaceDm / 10)) : groundY;
    return { groundY, surfaceY, wet, meters };
  }
}

function roadBlock(mark: number): BlockId {
  if (mark === 5) return Block.YellowConcrete;
  if (mark <= 2) return Block.LightGrayConcrete;
  return Block.GrayConcrete;
}

function surfaceBlock(column: Column, x: number, z: number): BlockId {
  if (column.wet) return column.meters < 650 ? Block.Sand : Block.Gravel;
  return groundCover(x, z, column.meters);
}

function fillBlock(column: Column, y: number, x: number, z: number, mark: number): BlockId {
  if (y <= HEIGHT.minY) return Block.Bedrock;
  if (mark && y === (column.wet ? column.surfaceY : column.groundY)) return roadBlock(mark);
  if (y > column.groundY && y <= column.surfaceY && column.wet) return Block.Water;
  if (y > column.groundY) return Block.Air;
  if (y < column.groundY - FILL_DEPTH) return Block.Air;
  if (y === column.groundY) return surfaceBlock(column, x, z);
  if (y >= column.groundY - 3) {
    if (column.wet) return column.meters < 650 ? Block.Sand : Block.Gravel;
    if (column.meters >= 1200) return Block.Stone;
    return Block.Dirt;
  }
  if (column.meters >= 1100) return Block.Stone;
  return Block.Stone;
}

export function levelDat(name: string, spawn: { x: number; y: number; z: number }, seed: bigint, flatStoneLayers = 124, tntExplodes = false): Buffer {
  const flag = (on: boolean) => byte(on ? 1 : 0);
  const layers = JSON.stringify({
    biome_id: BIOME_PLAINS,
    block_layers: [
      { block_name: "minecraft:bedrock", count: 1 },
      { block_name: "minecraft:stone", count: flatStoneLayers },
      { block_name: "minecraft:dirt", count: 3 },
      { block_name: "minecraft:grass_block", count: 1 },
    ],
    encoding_version: 6,
    preset_id: "",
    structure_options: null,
    world_version: "version.post_1_18",
  });
  const root = writeRoot({
    abilities: compound({
      attackmobs: flag(true),
      attackplayers: flag(false),
      build: flag(true),
      doorsandswitches: flag(true),
      flying: flag(false),
      flySpeed: float(0.05),
      instabuild: flag(true),
      invulnerable: flag(true),
      lightning: flag(false),
      mayfly: flag(true),
      mine: flag(true),
      mute: flag(false),
      noclip: flag(false),
      op: flag(true),
      opencontainers: flag(true),
      teleport: flag(true),
      verticalFlySpeed: float(1),
      walkSpeed: float(0.1),
    }),
    bonusChestEnabled: flag(false),
    bonusChestSpawned: flag(false),
    CenterMapsToOrigin: flag(false),
    cheatsEnabled: flag(true),
    commandsEnabled: flag(true),
    ConfirmedPlatformLockedContent: flag(false),
    currentTick: long(0),
    Difficulty: int(0),
    Dimension: int(0),
    eduOffer: int(0),
    educationFeaturesEnabled: flag(false),
    experiments: compound({
      experiments_ever_used: flag(false),
      saved_with_toggled_experiments: flag(false),
    }),
    FlatWorldLayers: str(layers),
    ForceGameType: flag(true),
    GameType: int(1),
    Generator: int(2),
    hasBeenLoadedInCreative: flag(true),
    hasLockedBehaviorPack: flag(false),
    hasLockedResourcePack: flag(false),
    immutableWorld: flag(false),
    InventoryVersion: str("1.21.50"),
    isCreatedInEditor: flag(false),
    isExportedFromEditor: flag(false),
    isFromLockedTemplate: flag(false),
    isFromWorldTemplate: flag(false),
    IsHardcore: flag(false),
    isRandomSeedAllowed: flag(false),
    IsSingleUseWorld: flag(false),
    isWorldTemplateOptionLocked: flag(false),
    LANBroadcast: flag(true),
    LANBroadcastIntent: flag(true),
    lastOpenedWithVersion: intList([1, 21, 50, 7, 0]),
    LastPlayed: long(BigInt(Math.floor(Date.now() / 1000))),
    LevelName: str(name),
    lightningLevel: float(0),
    lightningTime: int(0),
    LimitedWorldDepth: int(16),
    LimitedWorldOriginX: int(spawn.x),
    LimitedWorldOriginY: int(spawn.y),
    LimitedWorldOriginZ: int(spawn.z),
    LimitedWorldWidth: int(16),
    MinimumCompatibleClientVersion: intList([1, 21, 0, 0, 0]),
    MultiplayerGame: flag(true),
    MultiplayerGameIntent: flag(true),
    NetherScale: int(8),
    NetworkVersion: int(766),
    permissionsLevel: int(2),
    Platform: int(2),
    playerPermissionsLevel: int(2),
    playersleepingpercentage: int(100),
    rainLevel: float(0),
    rainTime: int(0),
    RandomSeed: long(seed),
    randomtickspeed: int(1),
    serverChunkTickRange: int(6),
    spawnMobs: flag(false),
    spawnradius: int(4),
    SpawnX: int(spawn.x),
    SpawnY: int(spawn.y),
    SpawnZ: int(spawn.z),
    startWithMapEnabled: flag(false),
    StorageVersion: int(10),
    texturePacksRequired: flag(false),
    Time: long(6000),
    useMsaGamertagsOnly: flag(false),
    worldStartCount: long(1),
    XBLBroadcastIntent: int(2),
    commandblockoutput: flag(true),
    commandblocksenabled: flag(true),
    dodaylightcycle: flag(false),
    doentitydrops: flag(true),
    dofiretick: flag(true),
    doimmediaterespawn: flag(false),
    doinsomnia: flag(false),
    dolimitedcrafting: flag(false),
    domobloot: flag(true),
    domobspawning: flag(false),
    dotiledrops: flag(true),
    doweathercycle: flag(false),
    drowningdamage: flag(false),
    falldamage: flag(false),
    firedamage: flag(false),
    freezedamage: flag(false),
    keepinventory: flag(true),
    mobgriefing: flag(false),
    naturalregeneration: flag(true),
    pvp: flag(false),
    recipesunlock: flag(true),
    respawnblocksexplode: flag(false),
    sendcommandfeedback: flag(true),
    showcoordinates: flag(true),
    showdaysplayed: flag(false),
    showdeathmessages: flag(true),
    showrecipemessages: flag(true),
    showtags: flag(true),
    tntexplodes: flag(tntExplodes),
  });
  const header = Buffer.alloc(8);
  header.writeInt32LE(10, 0);
  header.writeInt32LE(root.length, 4);
  return Buffer.concat([header, root]);
}

function renderIcon(samples: { x: number; z: number; column: Column }[], x0: number, z0: number, size: number): Buffer {
  const width = 400;
  const height = 225;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 20;
    data[i + 1] = 32;
    data[i + 2] = 42;
    data[i + 3] = 255;
  }
  for (const sample of samples) {
    const px = Math.min(width - 1, Math.floor(((sample.x - x0) / size) * width));
    const py = Math.min(height - 1, Math.floor(((sample.z - z0) / size) * height));
    const block = sample.column.wet ? Block.Water : surfaceBlock(sample.column, sample.x, sample.z);
    const [r, g, b] = BLOCKS[block].color;
    const shade = Math.max(0.7, Math.min(1.15, 0.85 + (sample.column.groundY + 20) / 200));
    const offset = (py * width + px) * 4;
    data[offset] = Math.max(0, Math.min(255, Math.round(r * shade)));
    data[offset + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
    data[offset + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
    data[offset + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 82).data;
}

export function exportDir(): string {
  return path.join(WORLD_DIR, "exports");
}

let roadCache: Road[] | null = null;

async function loadRoads(): Promise<Road[]> {
  if (roadCache) return roadCache;
  try {
    const bytes = await readFile(path.join(WORLD_DIR, "roads.bin"));
    roadCache = decodeRoads(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    roadCache = [];
  }
  return roadCache;
}

export async function buildRegionMcworld(
  raw: RegionSpec,
  onProgress?: (progress: RegionProgress) => void,
): Promise<{ bytes: Uint8Array; fileName: string; spawn: { x: number; y: number; z: number }; columns: number; wet: number }> {
  const { x0, z0, size, name } = alignRegion(raw);
  const roadGrid = rasterRoads(await loadRoads(), x0, z0, size);
  const paved = (x: number, z: number) => {
    const lx = x - x0;
    const lz = z - z0;
    if (lx < 0 || lz < 0 || lx >= size || lz >= size) return 0;
    return roadGrid[lz * size + lx];
  };
  const chunks = size / 16;
  const chunksTotal = chunks * chunks;
  const views = new ViewCache();
  const root = await mkdtemp(path.join(os.tmpdir(), "inw-region-"));
  const dbDir = path.join(root, "db");
  await mkdir(dbDir);

  let columns = 0;
  let wet = 0;
  let chunksDone = 0;
  let spawn: { x: number; y: number; z: number } | null = null;
  const iconSamples: { x: number; z: number; column: Column }[] = [];
  const centerX = x0 + size / 2;
  const centerZ = z0 + size / 2;

  try {
    const db = await Database.open(dbDir);
    try {
      let batch = new WriteBatch();
      let pending = 0;
      const version = Buffer.from([CHUNK_VERSION]);
      const finalized = Buffer.alloc(4);
      finalized.writeInt32LE(2, 0);
      const section = new Uint16Array(4096);

      const flush = () => {
        if (pending === 0) return;
        db.write(batch);
        batch = new WriteBatch();
        pending = 0;
      };

      for (let cz = 0; cz < chunks; cz += 1) {
        for (let cx = 0; cx < chunks; cx += 1) {
          const chunkX = x0 / 16 + cx;
          const chunkZ = z0 / 16 + cz;
          const heightmap = new Uint16Array(256);
          const local = new Array<Column | null>(256);
          let maxY: number = HEIGHT.minY;
          let any = false;

          for (let lz = 0; lz < 16; lz += 1) {
            for (let lx = 0; lx < 16; lx += 1) {
              const x = chunkX * 16 + lx;
              const z = chunkZ * 16 + lz;
              const column = await views.column(x, z);
              local[lz * 16 + lx] = column;
              if (!column) {
                heightmap[lz * 16 + lx] = HEIGHT.minY + 1;
                continue;
              }
              any = true;
              columns += 1;
              if (column.wet) wet += 1;
              const top = column.surfaceY;
              if (top > maxY) maxY = top;
              heightmap[lz * 16 + lx] = top + 1;
              if (
                !spawn ||
                Math.hypot(x + 0.5 - centerX, z + 0.5 - centerZ) < Math.hypot(spawn.x + 0.5 - centerX, spawn.z + 0.5 - centerZ)
              ) {
                if (!column.wet) spawn = { x, y: column.groundY + 1, z };
              }
              if (iconSamples.length < 12000 && (lx + lz) % 2 === 0) iconSamples.push({ x, z, column });
            }
          }

          chunksDone += 1;
          if (chunksDone % 16 === 0 || chunksDone === chunksTotal) {
            onProgress?.({ chunksDone, chunksTotal, columns, wet });
          }
          if (!any) continue;

          batch.put(chunkKey(chunkX, chunkZ, TAG_VERSION), version);
          batch.put(chunkKey(chunkX, chunkZ, TAG_FINALIZED), finalized);
          batch.put(chunkKey(chunkX, chunkZ, TAG_DATA_3D), encodeData3D(heightmap, BIOME_PLAINS));
          pending += 3;

          const maxSub = Math.min(MAX_SUBCHUNK, Math.floor(maxY / 16));
          for (let subY = MIN_SUBCHUNK; subY <= maxSub; subY += 1) {
            fillSubChunk(section, subY, (lx, y, lz) => {
              const column = local[lz * 16 + lx];
              if (!column) return Block.Air;
              return fillBlock(column, y, chunkX * 16 + lx, chunkZ * 16 + lz, paved(chunkX * 16 + lx, chunkZ * 16 + lz));
            });
            // Keep bedrock strip even in empty lower sections when the shell starts higher.
            if (subY === Math.floor(HEIGHT.minY / 16)) {
              for (let lz = 0; lz < 16; lz += 1) {
                for (let lx = 0; lx < 16; lx += 1) {
                  if (!local[lz * 16 + lx]) continue;
                  section[localIndex(lx, HEIGHT.minY & 15, lz)] = Block.Bedrock;
                }
              }
            }
            const encoded = encodeSubChunk(section, subY);
            if (encoded) {
              batch.put(chunkKey(chunkX, chunkZ, TAG_SUBCHUNK, subY), encoded);
              pending += 1;
            }
          }

          if (pending > 200) flush();
        }
      }
      flush();
    } finally {
      await db.close();
    }

    if (columns === 0) throw new Error("That rectangle has no terrain tiles yet.");
    if (!spawn) {
      // Entirely water: stand on the water surface near the center.
      const fallback = await views.column(Math.floor(centerX), Math.floor(centerZ));
      spawn = {
        x: Math.floor(centerX),
        y: (fallback?.surfaceY ?? 80) + 1,
        z: Math.floor(centerZ),
      };
    }

    const seed = BigInt(Math.floor(Math.abs(x0) * 73856093 + Math.abs(z0) * 19349663 + size) || 1);
    const files: Record<string, Uint8Array> = {
      "level.dat": levelDat(name, spawn, seed),
      "levelname.txt": Buffer.from(`${name}\n`, "utf8"),
      "world_icon.jpeg": renderIcon(iconSamples, x0, z0, size),
      "world_behavior_packs.json": Buffer.from("[]"),
      "world_resource_packs.json": Buffer.from("[]"),
    };
    files["level.dat_old"] = files["level.dat"];
    for (const entry of await readdir(dbDir)) {
      if (entry === "LOCK") continue;
      files[`db/${entry}`] = await readFile(path.join(dbDir, entry));
    }
    const bytes = zipSync(files, { level: 6 });
    return { bytes, fileName: exportFileName({ x0, z0, size, name }), spawn, columns, wet };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function writeRegionMcworld(
  raw: RegionSpec,
  onProgress?: (progress: RegionProgress) => void,
): Promise<{ path: string; fileName: string; spawn: { x: number; y: number; z: number }; columns: number; wet: number; bytes: number }> {
  const built = await buildRegionMcworld(raw, onProgress);
  const dir = exportDir();
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, built.fileName);
  await writeFile(out, built.bytes);
  return { path: out, fileName: built.fileName, spawn: built.spawn, columns: built.columns, wet: built.wet, bytes: built.bytes.byteLength };
}
