import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Database } from "@jsprismarine/leveldb";
import { readNamedCompound, type Nbt } from "@/lib/read-nbt";
import { chunkSections, chunkTops, meshChunkColumn } from "@/lib/chunk-mesh";

export type WorldInfo = {
  id: string;
  label: string;
  spawn: { x: number; y: number; z: number };
};

type OpenWorld = {
  info: WorldInfo;
  db: Database;
  meshes: Map<string, Buffer>;
  tops: Map<string, Buffer>;
};

const worlds = ((globalThis as unknown as { flyWorlds?: Map<string, OpenWorld> }).flyWorlds ??= new Map<string, OpenWorld>());

const ARCHIVE = path.join(process.cwd(), "data", "archive", "arnis");

function worldRoots(): string[] {
  return [path.join(ARCHIVE, "worlds"), path.join(ARCHIVE, "inland-northwest")];
}

async function findWorldFiles(): Promise<{ id: string; file: string }[]> {
  const found: { id: string; file: string }[] = [];
  const seen = new Set<string>();
  for (const root of worldRoots()) {
    let frontier = [root];
    for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const directory of frontier) {
        let names: string[] = [];
        try {
          names = await readdir(directory);
        } catch {
          continue;
        }
        for (const name of names) {
          if (name === "node_modules" || name === ".git" || name === ".next" || name === "cache") continue;
          const full = path.join(directory, name);
          if (name.endsWith(".mcworld")) {
            const id = path.basename(name, ".mcworld");
            if (seen.has(id)) continue;
            seen.add(id);
            found.push({ id, file: full });
          } else {
            const info = await stat(full).catch(() => null);
            if (info?.isDirectory()) next.push(full);
          }
        }
      }
      frontier = next;
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function numberTag(value: Nbt | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

async function unzipWorld(file: string, destination: string) {
  await mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("unzip", ["-o", "-q", file, "-d", destination], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Could not open ${path.basename(file)}`))));
  });
}

async function openWorld(id: string): Promise<OpenWorld> {
  const existing = worlds.get(id);
  if (existing) return existing;
  const files = await findWorldFiles();
  const match = files.find((world) => world.id === id);
  if (!match) throw new Error("That world is not in the folder next to this project.");
  const cache = path.join(ARCHIVE, "cache", id);
  const levelDat = path.join(cache, "level.dat");
  try {
    await stat(levelDat);
  } catch {
    await unzipWorld(match.file, cache);
  }
  const { readFile } = await import("node:fs/promises");
  const level = await readFile(levelDat);
  const nameFile = await readFile(path.join(cache, "levelname.txt"), "utf8").catch(() => id);
  const root = readNamedCompound(level, 8).value;
  const info: WorldInfo = {
    id,
    label: nameFile.trim() || id,
    spawn: {
      x: numberTag(root.SpawnX, 0),
      y: numberTag(root.SpawnY, 80),
      z: numberTag(root.SpawnZ, 0),
    },
  };
  const db = await Database.open(path.join(cache, "db"));
  const spawnChunkX = Math.floor(info.spawn.x / 16);
  const spawnChunkZ = Math.floor(info.spawn.z / 16);
  const mesh = meshChunkColumn(chunkSections((key) => db.get(key), spawnChunkX, spawnChunkZ));
  for (let offset = 2; offset < mesh.length; offset += 10) {
    const y = mesh.readInt16LE(offset);
    if (y + 8 > info.spawn.y) info.spawn.y = y + 8;
  }
  const opened = { info, db, meshes: new Map<string, Buffer>(), tops: new Map<string, Buffer>() };
  worlds.set(id, opened);
  return opened;
}

export async function listWorlds(): Promise<{ id: string; label: string }[]> {
  const files = await findWorldFiles();
  return files.map((file) => ({ id: file.id, label: file.id.replaceAll("-", " ") }));
}

export async function worldSpawn(id: string): Promise<WorldInfo> {
  return (await openWorld(id)).info;
}

export async function meshChunks(id: string, chunks: { cx: number; cz: number }[]): Promise<Buffer> {
  const world = await openWorld(id);
  const parts: Buffer[] = [];
  for (const chunk of chunks.slice(0, 12)) {
    const key = `${chunk.cx},${chunk.cz}`;
    let mesh = world.meshes.get(key);
    if (!mesh) {
      const sections = chunkSections((dbKey) => world.db.get(dbKey), chunk.cx, chunk.cz);
      mesh = meshChunkColumn(sections);
      if (world.meshes.size > 500) world.meshes.clear();
      world.meshes.set(key, mesh);
    }
    const header = Buffer.alloc(12);
    header.writeInt32LE(chunk.cx, 0);
    header.writeInt32LE(chunk.cz, 4);
    header.writeUInt32LE(mesh.length, 8);
    parts.push(header, mesh);
  }
  const count = Buffer.alloc(2);
  count.writeUInt16LE(parts.length / 2, 0);
  return Buffer.concat([count, ...parts]);
}

export function readChunkList(value: unknown, max: number): { cx: number; cz: number }[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((chunk): chunk is { cx: number; cz: number } => {
      if (!chunk || typeof chunk !== "object") return false;
      const point = chunk as { cx?: unknown; cz?: unknown };
      return Number.isInteger(point.cx) && Number.isInteger(point.cz) && Math.abs(point.cx as number) < 100000 && Math.abs(point.cz as number) < 100000;
    })
    .slice(0, max);
}

/** Per chunk: cx, cz as int32, then the 1280-byte column table from chunkTops. */
export async function topChunks(id: string, chunks: { cx: number; cz: number }[]): Promise<Buffer> {
  const world = await openWorld(id);
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.cx},${chunk.cz}`;
    let tops = world.tops.get(key);
    if (!tops) {
      tops = chunkTops(chunkSections((dbKey) => world.db.get(dbKey), chunk.cx, chunk.cz));
      if (world.tops.size > 20000) world.tops.clear();
      world.tops.set(key, tops);
    }
    const header = Buffer.alloc(8);
    header.writeInt32LE(chunk.cx, 0);
    header.writeInt32LE(chunk.cz, 4);
    parts.push(header, tops);
  }
  const count = Buffer.alloc(2);
  count.writeUInt16LE(chunks.length, 0);
  return Buffer.concat([count, ...parts]);
}
