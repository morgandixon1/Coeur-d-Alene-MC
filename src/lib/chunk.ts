import { BLOCKS, BLOCK_STATE_VERSION, type BlockId } from "@/lib/blocks";
import { compound, int, str, writeRoot, type NbtValue } from "@/lib/nbt";

export const TAG_DATA_3D = 0x2b;
export const TAG_VERSION = 0x2c;
export const TAG_SUBCHUNK = 0x2f;
export const TAG_BLOCK_ENTITY = 0x31;
export const TAG_FINALIZED = 0x36;

/** Chunk storage version: 1.18.30, which stores 24 biome palettes. */
export const CHUNK_VERSION = 40;
export const SUBCHUNK_VERSION = 9;
export const MIN_SUBCHUNK = -4;
export const MAX_SUBCHUNK = 19;

const BIT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 16];

export function localIndex(x: number, y: number, z: number): number {
  return ((x & 15) << 8) | ((z & 15) << 4) | (y & 15);
}

export function chunkKey(chunkX: number, chunkZ: number, tag: number, subY?: number): Buffer {
  const key = Buffer.alloc(subY === undefined ? 9 : 10);
  key.writeInt32LE(chunkX, 0);
  key.writeInt32LE(chunkZ, 4);
  key.writeUInt8(tag, 8);
  if (subY !== undefined) key.writeUInt8(subY & 0xff, 9);
  return key;
}

function bitsFor(count: number): number {
  if (count <= 1) return 0;
  for (const bits of BIT_CHOICES) {
    if (1 << bits >= count) return bits;
  }
  return 16;
}

function packIndices(indices: Uint16Array, bits: number): Buffer {
  if (bits === 0) return Buffer.alloc(0);
  const perWord = Math.floor(32 / bits);
  const words = Math.ceil(indices.length / perWord);
  const out = Buffer.alloc(words * 4);
  const mask = (1 << bits) - 1;
  for (let word = 0; word < words; word += 1) {
    let packed = 0;
    for (let slot = 0; slot < perWord; slot += 1) {
      const index = word * perWord + slot;
      if (index < indices.length) packed |= (indices[index] & mask) << (slot * bits);
    }
    out.writeUInt32LE(packed >>> 0, word * 4);
  }
  return out;
}

function blockStateTag(block: BlockId): Buffer {
  const def = BLOCKS[block];
  const states: Record<string, NbtValue> = {};
  for (const state of def.states) {
    if (state.kind === "byte") states[state.name] = { type: "byte", value: state.value };
    else if (state.kind === "int") states[state.name] = int(state.value);
    else states[state.name] = str(state.value);
  }
  return writeRoot({
    name: str(def.name),
    states: compound(states),
    version: int(BLOCK_STATE_VERSION),
  });
}

/**
 * Version-9 subchunk: one persistent block palette.
 * An all-air section is omitted; the game treats a missing subchunk as air.
 */
export function encodeSubChunk(blocks: ArrayLike<number>, subY: number): Buffer | null {
  let uniform = true;
  const first = blocks[0] ?? 0;
  for (let i = 1; i < 4096; i += 1) {
    if (blocks[i] !== first) {
      uniform = false;
      break;
    }
  }
  if (uniform && first === 0) return null;

  const palette: number[] = [];
  const lookup = new Map<number, number>();
  const indices = new Uint16Array(4096);
  for (let i = 0; i < 4096; i += 1) {
    const block = blocks[i] ?? 0;
    let id = lookup.get(block);
    if (id === undefined) {
      id = palette.length;
      lookup.set(block, id);
      palette.push(block);
    }
    indices[i] = id;
  }

  const bits = bitsFor(palette.length);
  const words = packIndices(indices, bits);
  const states = palette.map((block) => blockStateTag(block as BlockId));
  const header = Buffer.alloc(4);
  header.writeUInt8(SUBCHUNK_VERSION, 0);
  header.writeUInt8(1, 1);
  header.writeUInt8(subY & 0xff, 2);
  header.writeUInt8((bits << 1) & 0xff, 3);

  const parts: Buffer[] = [header, words];
  if (bits !== 0) {
    const length = Buffer.alloc(4);
    length.writeInt32LE(palette.length, 0);
    parts.push(length);
  }
  parts.push(...states);
  return Buffer.concat(parts);
}

/** Heightmap plus 24 single-biome palettes, one per subchunk from y=-4 through y=19. */
export function encodeData3D(heightmap: ArrayLike<number>, biomeId: number): Buffer {
  const out = Buffer.alloc(512 + 24 * 5);
  for (let i = 0; i < 256; i += 1) out.writeUInt16LE(heightmap[i] & 0xffff, i * 2);
  for (let section = 0; section < 24; section += 1) {
    const offset = 512 + section * 5;
    out.writeUInt8(0x01, offset);
    out.writeInt32LE(biomeId, offset + 1);
  }
  return out;
}

export function fillSubChunk(blocks: Uint16Array, subY: number, sample: (x: number, y: number, z: number) => number) {
  const baseY = subY * 16;
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let y = 0; y < 16; y += 1) {
        blocks[localIndex(x, y, z)] = sample(x, baseY + y, z);
      }
    }
  }
}
