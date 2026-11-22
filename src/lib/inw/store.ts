import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { WORLD } from "@/lib/inw/grid";

export const WORLD_DIR = path.join(process.cwd(), "data", "world");
export const SOURCES_DIR = path.join(process.cwd(), "data", "sources");

const CELLS = WORLD.tileSize * WORLD.tileSize;

/**
 * Layers live in data/world/<layer>/<level>/<tx>_<tz>.bin as zlib-deflated little-endian int16 planes,
 * each tileSize * tileSize, row-major with z rows and x columns. Values are decimeters unless a layer says otherwise.
 */
export function tileFile(layer: string, level: number, tx: number, tz: number): string {
  return path.join(WORLD_DIR, layer, String(level), `${tx}_${tz}.bin`);
}

export async function writeTile(layer: string, level: number, tx: number, tz: number, planes: Int16Array[]) {
  const file = tileFile(layer, level, tx, tz);
  await mkdir(path.dirname(file), { recursive: true });
  const raw = Buffer.concat(planes.map((plane) => Buffer.from(plane.buffer, plane.byteOffset, plane.byteLength)));
  const tmp = `${file}.part`;
  await writeFile(tmp, deflateSync(raw, { level: 6 }));
  await rename(tmp, file);
}

export async function readTile(layer: string, level: number, tx: number, tz: number, planes: number): Promise<Int16Array[] | null> {
  let packed: Buffer;
  try {
    packed = await readFile(tileFile(layer, level, tx, tz));
  } catch {
    return null;
  }
  const raw = inflateSync(packed);
  const out: Int16Array[] = [];
  for (let plane = 0; plane < planes; plane += 1) {
    const copy = new Int16Array(CELLS);
    Buffer.from(copy.buffer).set(raw.subarray(plane * CELLS * 2, (plane + 1) * CELLS * 2));
    out.push(copy);
  }
  return out;
}

export async function readTileBytes(layer: string, level: number, tx: number, tz: number): Promise<Buffer | null> {
  try {
    return await readFile(tileFile(layer, level, tx, tz));
  } catch {
    return null;
  }
}
