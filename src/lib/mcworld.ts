import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database, WriteBatch } from "@jsprismarine/leveldb";
import { zipSync } from "fflate";
import jpeg from "jpeg-js";
import { BLOCKS, Block, type BlockId } from "@/lib/blocks";
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
import { byte, compound, float, int, intList, long, str, writeRoot } from "@/lib/nbt";
import { fileNameFor, type Difficulty, type GameMode, type WorldSettings } from "@/lib/settings";
import { BASE_Y, blockAt, generateWorld, type GeneratedWorld, type SignPlacement } from "@/lib/terrain";

const GAME_TYPE: Record<GameMode, number> = {
  survival: 0,
  creative: 1,
  adventure: 2,
};

const DIFFICULTY: Record<Difficulty, number> = {
  peaceful: 0,
  easy: 1,
  normal: 2,
  hard: 3,
};

function flatLayers(biomeId: number): string {
  return JSON.stringify({
    biome_id: biomeId,
    block_layers: [
      { block_name: "minecraft:bedrock", count: 1 },
      { block_name: "minecraft:stone", count: 124 },
      { block_name: "minecraft:dirt", count: 3 },
      { block_name: "minecraft:grass_block", count: 1 },
    ],
    encoding_version: 6,
    preset_id: "",
    structure_options: null,
    world_version: "version.post_1_18",
  });
}

function signTag(sign: SignPlacement): Buffer {
  const face = (text: string) =>
    compound({
      Text: str(text),
      SignTextColor: int(-16777216),
      IgnoreLighting: byte(0),
      HideGlowOutline: byte(0),
      PersistFormatting: byte(1),
      TextOwner: str(""),
    });
  return writeRoot({
    id: str("Sign"),
    isMovable: byte(1),
    x: int(sign.x),
    y: int(sign.y),
    z: int(sign.z),
    FrontText: face(sign.text),
    BackText: face(""),
    IsWaxed: byte(0),
  });
}

export function buildLevelDat(world: GeneratedWorld): Buffer {
  const { settings, spawn } = world;
  const creative = settings.gameMode === "creative";
  const adventure = settings.gameMode === "adventure";
  const cheats = settings.cheats || creative;
  const flag = (on: boolean) => byte(on ? 1 : 0);
  const rules = {
    commandblockoutput: flag(true),
    commandblocksenabled: flag(cheats),
    dodaylightcycle: flag(!settings.freezeTime),
    doentitydrops: flag(true),
    dofiretick: flag(true),
    doimmediaterespawn: flag(false),
    doinsomnia: flag(settings.difficulty !== "peaceful"),
    dolimitedcrafting: flag(false),
    domobloot: flag(true),
    domobspawning: flag(true),
    dotiledrops: flag(true),
    doweathercycle: flag(true),
    drowningdamage: flag(!creative),
    falldamage: flag(!creative),
    firedamage: flag(!creative),
    freezedamage: flag(!creative),
    keepinventory: flag(false),
    mobgriefing: flag(true),
    naturalregeneration: flag(true),
    pvp: flag(false),
    recipesunlock: flag(true),
    respawnblocksexplode: flag(true),
    sendcommandfeedback: flag(true),
    showcoordinates: flag(true),
    showdaysplayed: flag(false),
    showdeathmessages: flag(true),
    showrecipemessages: flag(true),
    showtags: flag(true),
    tntexplodes: flag(true),
  };

  const root = writeRoot({
    abilities: compound({
      attackmobs: flag(!adventure),
      attackplayers: flag(false),
      build: flag(!adventure),
      doorsandswitches: flag(true),
      flying: flag(false),
      flySpeed: float(0.05),
      instabuild: flag(creative),
      invulnerable: flag(creative),
      lightning: flag(false),
      mayfly: flag(creative),
      mine: flag(!adventure),
      mute: flag(false),
      noclip: flag(false),
      op: flag(cheats),
      opencontainers: flag(true),
      teleport: flag(true),
      verticalFlySpeed: float(1),
      walkSpeed: float(0.1),
    }),
    bonusChestEnabled: flag(false),
    bonusChestSpawned: flag(false),
    CenterMapsToOrigin: flag(false),
    cheatsEnabled: flag(cheats),
    commandsEnabled: flag(cheats),
    ConfirmedPlatformLockedContent: flag(false),
    currentTick: long(0),
    Difficulty: int(DIFFICULTY[settings.difficulty]),
    Dimension: int(0),
    eduOffer: int(0),
    educationFeaturesEnabled: flag(false),
    experiments: compound({
      experiments_ever_used: flag(false),
      saved_with_toggled_experiments: flag(false),
    }),
    FlatWorldLayers: str(flatLayers(world.biomeId)),
    ForceGameType: flag(true),
    GameType: int(GAME_TYPE[settings.gameMode]),
    Generator: int(2),
    hasBeenLoadedInCreative: flag(creative || settings.cheats),
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
    LevelName: str(settings.name),
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
    permissionsLevel: int(cheats ? 2 : 1),
    Platform: int(2),
    playerPermissionsLevel: int(cheats ? 2 : 1),
    playersleepingpercentage: int(100),
    rainLevel: float(0),
    rainTime: int(0),
    RandomSeed: long(settings.seed),
    randomtickspeed: int(1),
    serverChunkTickRange: int(6),
    spawnMobs: flag(true),
    spawnradius: int(4),
    SpawnX: int(spawn.x),
    SpawnY: int(spawn.y),
    SpawnZ: int(spawn.z),
    startWithMapEnabled: flag(false),
    StorageVersion: int(10),
    texturePacksRequired: flag(false),
    Time: long(settings.timeOfDay),
    useMsaGamertagsOnly: flag(false),
    worldStartCount: long(1),
    XBLBroadcastIntent: int(2),
    ...rules,
  });

  const header = Buffer.alloc(8);
  header.writeInt32LE(10, 0);
  header.writeInt32LE(root.length, 4);
  return Buffer.concat([header, root]);
}

function renderIcon(world: GeneratedWorld): Buffer {
  const width = 400;
  const height = 225;
  const data = Buffer.alloc(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    const z = Math.min(world.size - 1, Math.floor((py / height) * world.size));
    for (let px = 0; px < width; px += 1) {
      const x = Math.min(world.size - 1, Math.floor((px / width) * world.size));
      const i = z * world.size + x;
      const block = (world.waterTop[i] >= 0 ? Block.Water : world.surface[i]) as BlockId;
      const [r, g, b] = BLOCKS[block].color;
      const shade = Math.max(0.72, Math.min(1.08, 0.8 + (world.heights[i] - BASE_Y) / 28));
      const offset = (py * width + px) * 4;
      data[offset] = Math.max(0, Math.min(255, Math.round(r * shade)));
      data[offset + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
      data[offset + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
      data[offset + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 82).data;
}

function writeChunks(batch: WriteBatch, world: GeneratedWorld) {
  const chunkCount = world.size / 16;
  const column = new Uint16Array(4096);
  const finalized = Buffer.alloc(4);
  finalized.writeInt32LE(2, 0);
  const version = Buffer.from([CHUNK_VERSION]);

  for (let chunkZ = 0; chunkZ < chunkCount; chunkZ += 1) {
    for (let chunkX = 0; chunkX < chunkCount; chunkX += 1) {
      const heightmap = new Uint16Array(256);
      let maxY = BASE_Y;
      for (let lz = 0; lz < 16; lz += 1) {
        for (let lx = 0; lx < 16; lx += 1) {
          const x = chunkX * 16 + lx;
          const z = chunkZ * 16 + lz;
          const top = world.columnMax[z * world.size + x];
          if (top > maxY) maxY = top;
          heightmap[lz * 16 + lx] = top + 1;
        }
      }

      batch.put(chunkKey(chunkX, chunkZ, TAG_VERSION), version);
      batch.put(chunkKey(chunkX, chunkZ, TAG_FINALIZED), finalized);
      batch.put(chunkKey(chunkX, chunkZ, TAG_DATA_3D), encodeData3D(heightmap, world.biomeId));

      const maxSub = Math.min(MAX_SUBCHUNK, Math.floor(maxY / 16));
      for (let subY = MIN_SUBCHUNK; subY <= maxSub; subY += 1) {
        fillSubChunk(column, subY, (x, y, z) => blockAt(world, chunkX * 16 + x, y, chunkZ * 16 + z));
        const encoded = encodeSubChunk(column, subY);
        if (encoded) batch.put(chunkKey(chunkX, chunkZ, TAG_SUBCHUNK, subY), encoded);
      }

      const signs = world.signs.filter(
        (sign) => Math.floor(sign.x / 16) === chunkX && Math.floor(sign.z / 16) === chunkZ,
      );
      if (signs.length > 0) {
        batch.put(chunkKey(chunkX, chunkZ, TAG_BLOCK_ENTITY), Buffer.concat(signs.map(signTag)));
      }
    }
  }
}

export async function buildMcworld(settings: WorldSettings): Promise<Uint8Array> {
  const world = generateWorld(settings);
  const root = await mkdtemp(path.join(os.tmpdir(), "spawnwright-"));
  const dbDir = path.join(root, "db");
  await mkdir(dbDir);
  try {
    const db = await Database.open(dbDir);
    try {
      const batch = new WriteBatch();
      writeChunks(batch, world);
      db.write(batch);
    } finally {
      await db.close();
    }

    const files: Record<string, Uint8Array> = {
      "level.dat": buildLevelDat(world),
      "levelname.txt": Buffer.from(`${settings.name}\n`, "utf8"),
      "world_icon.jpeg": renderIcon(world),
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

export { fileNameFor };
