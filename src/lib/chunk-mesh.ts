import { localIndex, TAG_SUBCHUNK, chunkKey, MIN_SUBCHUNK, MAX_SUBCHUNK } from "@/lib/chunk";
import { readNamedCompound } from "@/lib/read-nbt";

const KEEP_BELOW_TOP = 24;

type Rgb = [number, number, number];

const DYES: [string, Rgb][] = [
  ["light_gray", [142, 142, 134]],
  ["light_blue", [58, 175, 217]],
  ["white", [226, 228, 228]],
  ["gray", [70, 75, 78]],
  ["black", [28, 28, 32]],
  ["brown", [114, 71, 40]],
  ["red", [160, 39, 34]],
  ["orange", [232, 118, 26]],
  ["yellow", [240, 190, 45]],
  ["lime", [112, 185, 25]],
  ["green", [84, 109, 27]],
  ["cyan", [21, 137, 145]],
  ["blue", [53, 57, 157]],
  ["purple", [121, 42, 172]],
  ["magenta", [189, 68, 179]],
  ["pink", [237, 141, 172]],
];

const WOODS: [string, Rgb, Rgb][] = [
  ["dark_oak", [66, 43, 20], [60, 47, 30]],
  ["oak", [162, 130, 78], [104, 82, 50]],
  ["spruce", [114, 84, 48], [58, 38, 18]],
  ["birch", [192, 175, 121], [214, 210, 196]],
  ["jungle", [160, 115, 80], [85, 68, 25]],
  ["acacia", [168, 90, 50], [103, 96, 86]],
  ["mangrove", [117, 54, 48], [84, 66, 40]],
  ["cherry", [226, 178, 172], [54, 33, 44]],
  ["crimson", [101, 48, 70], [92, 25, 29]],
  ["warped", [43, 104, 99], [58, 58, 77]],
];

const MATERIALS: [RegExp, Rgb][] = [
  [/water/, [52, 96, 190]],
  [/lava|magma/, [210, 90, 20]],
  [/ice/, [145, 183, 253]],
  [/snow|powder_snow/, [240, 250, 250]],
  [/grass_block|grass_path|dirt_path/, [95, 159, 53]],
  [/moss/, [89, 109, 45]],
  [/azalea_leaves/, [90, 130, 50]],
  [/birch_leaves/, [110, 150, 70]],
  [/spruce_leaves/, [45, 85, 50]],
  [/leaves/, [62, 122, 44]],
  [/mushroom_stem/, [203, 196, 185]],
  [/mud_brick/, [137, 103, 79]],
  [/podzol/, [91, 63, 24]],
  [/mud|dirt|farmland|rooted/, [134, 96, 67]],
  [/red_sand/, [190, 102, 33]],
  [/sand/, [219, 207, 163]],
  [/gravel/, [131, 127, 126]],
  [/hardened_clay|terracotta/, [152, 94, 67]],
  [/clay/, [160, 166, 179]],
  [/blackstone/, [42, 36, 41]],
  [/deepslate|basalt/, [80, 80, 85]],
  [/tuff/, [108, 109, 102]],
  [/calcite/, [223, 224, 220]],
  [/granite/, [149, 103, 85]],
  [/diorite/, [188, 188, 188]],
  [/andesite/, [136, 136, 136]],
  [/stone_brick/, [122, 121, 122]],
  [/brick/, [150, 97, 83]],
  [/quartz/, [235, 229, 222]],
  [/glass/, [175, 213, 219]],
  [/iron|anvil/, [210, 210, 210]],
  [/cobble/, [118, 118, 118]],
  [/bedrock/, [50, 50, 50]],
  [/obsidian/, [20, 18, 30]],
  [/stone/, [125, 125, 125]],
];

const SKIPPED =
  /^(air|cave_air|void_air|light_block.*|structure_void|barrier|short_grass|tall_grass|grass|fern|large_fern|seagrass|tall_seagrass|kelp.*|.*rail|.*torch|.*_sapling|sweet_berry_bush|dead_bush|vine|.*flower.*|dandelion|poppy|.*tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid|lily_of_the_valley|.*_button|.*pressure_plate|lever|ladder|.*_sign|.*wall_sign|.*_banner|snow_layer|.*_mushroom|.*carpet)$/;

const colorCache = new Map<string, Rgb>();

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - amount) + b[i] * amount)) as Rgb;
}

export function isSkipped(name: string): boolean {
  return SKIPPED.test(name.replace(/^minecraft:/, ""));
}

export function colorFor(name: string): Rgb {
  const cached = colorCache.get(name);
  if (cached) return cached;
  const color = pickColor(name.replace(/^minecraft:/, ""));
  colorCache.set(name, color);
  return color;
}

function pickColor(key: string): Rgb {
  for (const [dye, color] of DYES) {
    if (!key.startsWith(`${dye}_`)) continue;
    if (/terracotta/.test(key)) return mix(color, [152, 94, 67], 0.45);
    if (/glass/.test(key)) return mix(color, [200, 220, 225], 0.35);
    return color;
  }
  for (const [wood, planks, log] of WOODS) {
    if (!key.startsWith(`${wood}_`) && !key.startsWith(`stripped_${wood}_`)) continue;
    if (/leaves/.test(key)) break;
    return /log|wood|stem|hyphae/.test(key) && !key.startsWith("stripped_") ? log : planks;
  }
  for (const [pattern, color] of MATERIALS) {
    if (pattern.test(key)) return color;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return hsl(hash % 360, 22, 52);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s / 100;
  const b = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => b - a * Math.min(b, 1 - b) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function readIndices(buf: Buffer, offset: number, bits: number): { indices: Uint16Array; offset: number } {
  const indices = new Uint16Array(4096);
  if (bits === 0) return { indices, offset };
  const perWord = Math.floor(32 / bits);
  const words = Math.ceil(4096 / perWord);
  const mask = (1 << bits) - 1;
  for (let word = 0; word < words; word += 1) {
    const packed = buf.readUInt32LE(offset + word * 4);
    for (let slot = 0; slot < perWord; slot += 1) {
      const index = word * perWord + slot;
      if (index < 4096) indices[index] = (packed >>> (slot * bits)) & mask;
    }
  }
  return { indices, offset: offset + words * 4 };
}

function paletteNames(buf: Buffer, offset: number, bits: number): { names: string[]; offset: number } {
  let count = 1;
  let cursor = offset;
  if (bits !== 0) {
    count = buf.readInt32LE(cursor);
    cursor += 4;
  }
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const tag = readNamedCompound(buf, cursor);
    const name = tag.value.name;
    names.push(typeof name === "string" ? name : "minecraft:stone");
    cursor = tag.offset;
  }
  return { names, offset: cursor };
}

export function decodeSubchunk(buf: Buffer, fallbackY: number): Map<number, string> | null {
  if (buf.length < 3) return null;
  let offset = 0;
  const version = buf.readUInt8(offset);
  offset += 1;
  let storages = 1;
  if (version >= 8) {
    storages = buf.readUInt8(offset);
    offset += 1;
  }
  let subY = fallbackY;
  if (version >= 9) {
    subY = buf.readInt8(offset);
    offset += 1;
  }
  if (storages < 1) return null;
  const header = buf.readUInt8(offset);
  offset += 1;
  const bits = header >> 1;
  const words = readIndices(buf, offset, bits);
  const palette = paletteNames(buf, words.offset, bits);
  const blocks = new Map<number, string>();
  const baseY = subY * 16;
  for (let i = 0; i < 4096; i += 1) {
    const name = palette.names[words.indices[i]] ?? palette.names[0];
    if (!name || name === "minecraft:air") continue;
    const x = (i >> 8) & 15;
    const z = (i >> 4) & 15;
    const y = baseY + (i & 15);
    blocks.set(localIndex(x, y & 15, z) + (y << 16), name);
  }
  return blocks;
}

type Occupant = { x: number; y: number; z: number; name: string };

function pack(x: number, y: number, z: number): number {
  return ((y + 64) << 16) | (z << 8) | x;
}

function columnBlocks(sections: { subY: number; data: Buffer }[]): Map<number, string> {
  const blocks = new Map<number, string>();
  for (const section of sections) {
    const decoded = decodeSubchunk(section.data, section.subY);
    if (!decoded) continue;
    for (const [key, name] of decoded) {
      if (isSkipped(name)) continue;
      const y = key >> 16;
      const index = key & 0xffff;
      const x = (index >> 8) & 15;
      const z = (index >> 4) & 15;
      blocks.set(pack(x, y, z), name);
    }
  }
  return blocks;
}

export const NO_TOP = -32768;

/** 256 columns, z-major, of 5 bytes each: r, g, b, then the top block's y as int16 (NO_TOP when empty). */
export function chunkTops(sections: { subY: number; data: Buffer }[]): Buffer {
  const out = Buffer.alloc(256 * 5);
  const tops = new Int16Array(256).fill(NO_TOP);
  const names: string[] = new Array(256);
  for (const [key, name] of columnBlocks(sections)) {
    const y = (key >> 16) - 64;
    const column = ((key >> 8) & 15) * 16 + (key & 15);
    if (y > tops[column]) {
      tops[column] = y;
      names[column] = name;
    }
  }
  for (let column = 0; column < 256; column += 1) {
    const at = column * 5;
    if (tops[column] !== NO_TOP) {
      const color = colorFor(names[column]);
      out.writeUInt8(color[0], at);
      out.writeUInt8(color[1], at + 1);
      out.writeUInt8(color[2], at + 2);
    }
    out.writeInt16LE(tops[column], at + 3);
  }
  return out;
}

const FACE_LIGHT = [0.8, 0.8, 0.55, 1, 0.68, 0.68];

export function meshChunkColumn(sections: { subY: number; data: Buffer }[]): Buffer {
  const blocks = columnBlocks(sections);

  const tops = new Int16Array(256).fill(-999);
  for (const key of blocks.keys()) {
    const y = (key >> 16) - 64;
    const x = key & 15;
    const z = (key >> 8) & 15;
    const column = z * 16 + x;
    if (y > tops[column]) tops[column] = y;
  }

  const kept = new Map<number, Occupant>();
  for (const [key, name] of blocks) {
    const y = (key >> 16) - 64;
    const x = key & 15;
    const z = (key >> 8) & 15;
    if (y < tops[z * 16 + x] - KEEP_BELOW_TOP) continue;
    kept.set(key, { x, y, z, name });
  }

  const vertices: number[] = [];
  const pushFace = (x: number, y: number, z: number, face: number, base: Rgb) => {
    const light = FACE_LIGHT[face];
    const color = base.map((channel) => Math.round(channel * light)) as Rgb;
    const corners: [number, number, number][][] = [
      [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    ];
    const quad = corners[face];
    const order = [0, 1, 2, 0, 2, 3];
    for (const corner of order) {
      const point = quad[corner];
      vertices.push(x + point[0], y + point[1], z + point[2], color[0], color[1], color[2]);
    }
  };

  const neighborEmpty = (x: number, y: number, z: number) => {
    if (x < 0 || x > 15 || z < 0 || z > 15) return true;
    return !kept.has(pack(x, y, z));
  };

  for (const block of kept.values()) {
    const color = colorFor(block.name);
    const faces: [number, number, number][] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ];
    faces.forEach((offset, face) => {
      if (neighborEmpty(block.x + offset[0], block.y + offset[1], block.z + offset[2])) {
        pushFace(block.x, block.y, block.z, face, color);
      }
    });
  }

  const count = vertices.length / 6;
  const out = Buffer.alloc(count * 10);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const src = vertex * 6;
    const at = vertex * 10;
    out.writeInt16LE(vertices[src], at);
    out.writeInt16LE(vertices[src + 1], at + 2);
    out.writeInt16LE(vertices[src + 2], at + 4);
    out.writeUInt8(vertices[src + 3], at + 6);
    out.writeUInt8(vertices[src + 4], at + 7);
    out.writeUInt8(vertices[src + 5], at + 8);
  }
  return out;
}

export function chunkSections(get: (key: Buffer) => Buffer | null, chunkX: number, chunkZ: number) {
  const sections: { subY: number; data: Buffer }[] = [];
  for (let subY = MIN_SUBCHUNK; subY <= MAX_SUBCHUNK; subY += 1) {
    const data = get(chunkKey(chunkX, chunkZ, TAG_SUBCHUNK, subY));
    if (data && data.length > 0) sections.push({ subY, data });
  }
  return sections;
}
