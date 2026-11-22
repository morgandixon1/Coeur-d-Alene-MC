import { Block, blockLabel, type BlockId } from "@/lib/blocks";
import { SIZE_BLOCKS, type ThemeId, type WorldSettings } from "@/lib/settings";

export const BASE_Y = 64;
export const MIN_Y = -64;

export type SignPlacement = {
  x: number;
  y: number;
  z: number;
  text: string;
};

export type WorldFeature = {
  x: number;
  y: number;
  z: number;
  block: BlockId;
};

export type GeneratedWorld = {
  settings: WorldSettings;
  size: number;
  biomeId: number;
  heights: Uint16Array;
  surface: Uint8Array;
  waterTop: Int16Array;
  columnMax: Uint16Array;
  features: WorldFeature[];
  featureIndex: Map<number, BlockId>;
  signs: SignPlacement[];
  spawn: { x: number; y: number; z: number };
  summary: string[];
};

type Draft = {
  size: number;
  heights: Uint16Array;
  surface: Uint8Array;
  waterTop: Int16Array;
  reserved: Uint8Array;
  index: Map<number, BlockId>;
  signs: SignPlacement[];
  spawn: { x: number; y: number; z: number };
};

export function posKey(x: number, y: number, z: number): number {
  return (y + 64) * 65536 + z * 256 + x;
}

export function hash01(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1440671579);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const v00 = hash01(x0, z0, seed);
  const v10 = hash01(x0 + 1, z0, seed);
  const v01 = hash01(x0, z0 + 1, seed);
  const v11 = hash01(x0 + 1, z0 + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fz;
}

function fbm(x: number, z: number, seed: number): number {
  return valueNoise(x, z, seed) * 0.62 + valueNoise(x * 2.13, z * 2.13, seed + 101) * 0.38;
}

function createDraft(size: number): Draft {
  const cells = size * size;
  const surface = new Uint8Array(cells);
  surface.fill(Block.Grass);
  return {
    size,
    heights: new Uint16Array(cells).fill(BASE_Y),
    surface,
    waterTop: new Int16Array(cells).fill(-1),
    reserved: new Uint8Array(cells),
    index: new Map(),
    signs: [],
    spawn: { x: Math.floor(size / 2), y: BASE_Y + 1, z: Math.floor(size / 2) },
  };
}

function idx(draft: Draft, x: number, z: number): number {
  return z * draft.size + x;
}

function inside(draft: Draft, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < draft.size && z < draft.size;
}

function edgeDistance(draft: Draft, x: number, z: number): number {
  return Math.min(x, z, draft.size - 1 - x, draft.size - 1 - z);
}

function blend(draft: Draft, x: number, z: number, height: number, margin = 12): number {
  const edge = edgeDistance(draft, x, z);
  if (edge <= 0) return BASE_Y;
  const t = Math.min(1, edge / margin);
  const s = fade(t);
  return Math.round(BASE_Y + (height - BASE_Y) * s);
}

function setColumn(draft: Draft, x: number, z: number, height: number, surface: BlockId, water = -1) {
  if (!inside(draft, x, z)) return;
  const i = idx(draft, x, z);
  draft.heights[i] = height;
  draft.surface[i] = surface;
  draft.waterTop[i] = water;
}

function reserve(draft: Draft, x: number, z: number) {
  if (inside(draft, x, z)) draft.reserved[idx(draft, x, z)] = 1;
}

function place(draft: Draft, x: number, y: number, z: number, block: BlockId): boolean {
  if (!inside(draft, x, z) || y <= MIN_Y || y > 180) return false;
  draft.index.set(posKey(x, y, z), block);
  return true;
}

function slope(draft: Draft, x: number, z: number): number {
  const h = draft.heights[idx(draft, x, z)];
  let max = 0;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const nz = z + dz;
    if (!inside(draft, nx, nz)) continue;
    max = Math.max(max, Math.abs(draft.heights[idx(draft, nx, nz)] - h));
  }
  return max;
}

function flatten(draft: Draft, x0: number, z0: number, w: number, d: number, surface: BlockId): number {
  let top = BASE_Y;
  for (let z = z0; z < z0 + d; z += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (!inside(draft, x, z)) continue;
      top = Math.max(top, draft.heights[idx(draft, x, z)]);
    }
  }
  for (let z = z0; z < z0 + d; z += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      setColumn(draft, x, z, top, surface);
      reserve(draft, x, z);
    }
  }
  return top;
}

function line(x0: number, z0: number, x1: number, z1: number, visit: (x: number, z: number) => void) {
  let x = x0;
  let z = z0;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  for (;;) {
    visit(x, z);
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
  }
}

function paintPath(draft: Draft, x0: number, z0: number, x1: number, z1: number, block: BlockId) {
  line(x0, z0, x1, z1, (x, z) => {
    if (!inside(draft, x, z) || draft.reserved[idx(draft, x, z)]) return;
    if (draft.waterTop[idx(draft, x, z)] >= 0) return;
    draft.surface[idx(draft, x, z)] = block;
  });
}

function tree(draft: Draft, x: number, z: number, kind: "spruce" | "oak", seed: number) {
  if (!inside(draft, x, z) || draft.reserved[idx(draft, x, z)]) return;
  if (edgeDistance(draft, x, z) < 8 || slope(draft, x, z) > 2) return;
  if (draft.waterTop[idx(draft, x, z)] >= 0) return;
  const ground = draft.heights[idx(draft, x, z)];
  const trunk = 4 + (hash01(x, z, seed + 7) > 0.62 ? 1 : 0);
  const log = kind === "spruce" ? Block.SpruceLog : Block.OakLog;
  const leaves = kind === "spruce" ? Block.SpruceLeaves : Block.OakLeaves;
  reserve(draft, x, z);
  for (let i = 1; i <= trunk; i += 1) place(draft, x, ground + i, z, log);
  const top = ground + trunk;
  const radius = kind === "spruce" ? 2 : 2;
  for (let dy = kind === "spruce" ? -2 : -1; dy <= 1; dy += 1) {
    const r = dy === 1 ? 1 : radius;
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && hash01(x + dx, z + dz, seed + dy + 3) > 0.55) continue;
        const key = posKey(x + dx, top + dy, z + dz);
        if (draft.index.has(key)) continue;
        place(draft, x + dx, top + dy, z + dz, leaves);
      }
    }
  }
}

function scatterTrees(draft: Draft, seed: number, kind: "spruce" | "oak", chance: number, surfaceOk: (block: BlockId) => boolean) {
  for (let z = 2; z < draft.size - 2; z += 1) {
    for (let x = 2; x < draft.size - 2; x += 1) {
      if (hash01(x, z, seed + 17) > chance) continue;
      if (!surfaceOk(draft.surface[idx(draft, x, z)] as BlockId)) continue;
      tree(draft, x, z, kind, seed);
    }
  }
}

function cabin(
  draft: Draft,
  x0: number,
  z0: number,
  w: number,
  d: number,
  log: BlockId,
  plank: BlockId,
  fence: BlockId,
): number {
  const y = flatten(draft, x0 - 1, z0 - 1, w + 2, d + 2, Block.CoarseDirt);
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) {
      setColumn(draft, x0 + x, z0 + z, y, plank);
      const edgeX = x === 0 || x === w - 1;
      const edgeZ = z === 0 || z === d - 1;
      const corner = edgeX && edgeZ;
      if (!edgeX && !edgeZ) continue;
      const door = z === 0 && x === Math.floor(w / 2);
      for (let wy = 1; wy <= 3; wy += 1) {
        if (door && wy <= 2) continue;
        const window = !corner && wy === 2 && ((x + z) % 2 === 0);
        const block = window ? Block.Glass : corner ? log : plank;
        place(draft, x0 + x, y + wy, z0 + z, block);
      }
    }
  }
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) place(draft, x0 + x, y + 4, z0 + z, plank);
  }
  place(draft, x0 + Math.floor(w / 2), y + 3, z0 + Math.floor(d / 2), Block.Glowstone);
  place(draft, x0 + Math.floor(w / 2) - 1, y + 1, z0 - 1, Block.Hay);
  place(draft, x0 + Math.floor(w / 2) + 1, y + 1, z0 - 1, fence);
  return y;
}

function sign(draft: Draft, x: number, z: number, text: string) {
  if (!inside(draft, x, z)) return;
  const y = draft.heights[idx(draft, x, z)] + 1;
  place(draft, x, y, z, Block.OakSign);
  draft.signs.push({ x, y, z, text });
}

function sealEdges(draft: Draft) {
  for (let z = 0; z < draft.size; z += 1) {
    for (let x = 0; x < draft.size; x += 1) {
      if (edgeDistance(draft, x, z) > 1) continue;
      setColumn(draft, x, z, BASE_Y, Block.Grass, -1);
      draft.reserved[idx(draft, x, z)] = 1;
    }
  }
  for (const key of draft.index.keys()) {
    const x = key % 256;
    const z = Math.floor(key / 256) % 256;
    if (edgeDistance(draft, x, z) <= 1) draft.index.delete(key);
  }
}

function buildPine(draft: Draft, seed: number, notes: string[], name: string) {
  const { size } = draft;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x / 26, z / 26, seed);
      const raw = 64 + Math.round((n - 0.4) * 18);
      const h = Math.max(BASE_Y, Math.min(84, blend(draft, x, z, raw)));
      setColumn(draft, x, z, h, h > 74 ? Block.Podzol : Block.Grass);
    }
  }
  const cx = Math.floor(size / 2);
  const cz = Math.floor(size / 2);
  const plaza = draft.heights[idx(draft, cx, cz)];
  for (let dz = -4; dz <= 4; dz += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      if (dx * dx + dz * dz > 20) continue;
      const block = dx * dx + dz * dz <= 4 ? Block.MossyCobblestone : Block.Cobblestone;
      setColumn(draft, cx + dx, cz + dz, plaza, block);
      reserve(draft, cx + dx, cz + dz);
    }
  }
  const ringZ = Math.min(size - 10, cz + 8);
  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx * dx + dz * dz > 5) continue;
      setColumn(draft, cx + dx, ringZ + dz, draft.heights[idx(draft, cx, ringZ)], Block.MossyCobblestone);
      reserve(draft, cx + dx, ringZ + dz);
    }
  }
  const ringY = draft.heights[idx(draft, cx, ringZ)];
  place(draft, cx, ringY + 1, ringZ, Block.Campfire);
  place(draft, cx, ringY, ringZ, Block.Glowstone);
  for (const [dx, dz] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    place(draft, cx + dx, ringY + 1, ringZ + dz, Block.OakLog);
  }

  const cabinX = Math.min(size - 16, cx + 14);
  const cabinZ = Math.max(8, cz - 8);
  const floor = cabin(draft, cabinX, cabinZ, 7, 5, Block.SpruceLog, Block.SprucePlanks, Block.SpruceFence);
  paintPath(draft, cx, cz + 4, cabinX + 3, cabinZ, Block.CoarseDirt);
  for (let step = 0; step <= 12; step += 6) {
    const x = Math.round(cx + ((cabinX + 3 - cx) * step) / 12);
    const z = Math.round(cz + 4 + ((cabinZ - (cz + 4)) * step) / 12);
    if (!inside(draft, x, z) || draft.reserved[idx(draft, x, z)]) continue;
    const y = draft.heights[idx(draft, x, z)];
    place(draft, x, y + 1, z, Block.SpruceFence);
    place(draft, x, y + 2, z, Block.Lantern);
  }
  sign(draft, cx + 2, cz, `${name}\nMeet here`);
  draft.spawn = { x: cx, y: plaza + 1, z: cz };
  scatterTrees(draft, seed, "spruce", 0.022, (block) => block === Block.Grass || block === Block.Podzol);
  notes.push("Mossy meeting stone at the middle of the camp.");
  notes.push("Fire ring just south of it, with log seats.");
  notes.push(`Spruce cabin on the rise, floor at y=${floor}.`);
  notes.push("A dirt path and lantern posts connect the two.");
}

function buildCove(draft: Draft, seed: number, notes: string[], name: string) {
  const { size } = draft;
  const cx = (size - 1) / 2;
  const cz = (size - 1) / 2;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const dist = Math.hypot(x - cx, z - cz) / (size * 0.46);
      const dune = fbm(x / 18, z / 18, seed);
      let h = 66 + Math.round((dune - 0.45) * 8);
      if (dist < 0.28) h = 58;
      else if (dist < 0.46) h = 58 + Math.round(((dist - 0.28) / 0.18) * (h - 58));
      h = Math.max(56, Math.min(78, blend(draft, x, z, h, 14)));
      const water = h <= 62 && edgeDistance(draft, x, z) > 3 ? 63 : -1;
      const sand = h <= 67;
      setColumn(draft, x, z, h, sand ? Block.Sand : Block.Grass, water);
    }
  }
  const midX = Math.floor(size / 2);
  let shore = Math.floor(cz);
  while (shore < size - 6 && draft.heights[idx(draft, midX, shore)] < BASE_Y) shore += 1;
  let dockEnd = shore;
  for (let z = shore; z >= Math.max(6, shore - 16); z -= 1) {
    if (draft.heights[idx(draft, midX, z)] > BASE_Y && z !== shore) break;
    place(draft, midX, BASE_Y, z, Block.OakPlanks);
    reserve(draft, midX, z);
    if ((shore - z) % 4 === 0) {
      place(draft, midX - 1, BASE_Y + 1, z, Block.OakFence);
      place(draft, midX + 1, BASE_Y + 1, z, Block.OakFence);
    }
    dockEnd = z;
  }
  const hutX = Math.min(size - 14, midX + 16);
  const hutZ = Math.max(8, Math.floor(cz) - 4);
  if (draft.waterTop[idx(draft, hutX, hutZ)] < 0) {
    cabin(draft, hutX, hutZ, 5, 4, Block.OakLog, Block.OakPlanks, Block.OakFence);
    paintPath(draft, midX + 1, shore, hutX + 2, hutZ, Block.Gravel);
  }
  sign(draft, midX + 1, Math.max(0, shore - 1), `${name}\nDock`);
  draft.spawn = { x: midX, y: BASE_Y + 1, z: Math.max(dockEnd, shore - 2) };
  scatterTrees(draft, seed, "oak", 0.02, (block) => block === Block.Grass || block === Block.Sand);
  notes.push("Lagoon in the middle, shallow enough to see the sand.");
  notes.push("Oak dock running from the south shore into the water.");
  notes.push("A small hut and a gravel path on the east dune.");
}

function buildMesa(draft: Draft, seed: number, notes: string[], name: string) {
  const { size } = draft;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x / 22, z / 22, seed);
      const stepped = 64 + Math.round(n * 6) * 3;
      const h = Math.max(BASE_Y, Math.min(88, blend(draft, x, z, stepped, 14)));
      setColumn(draft, x, z, h, Block.RedSand);
    }
  }
  const cx = Math.floor(size / 2);
  const cz = Math.floor(size / 2);
  let bestX = cx;
  let bestZ = cz;
  let best = 0;
  for (let z = 10; z < size - 10; z += 1) {
    for (let x = 10; x < size - 10; x += 1) {
      const h = draft.heights[idx(draft, x, z)];
      if (h > best) {
        best = h;
        bestX = x;
        bestZ = z;
      }
    }
  }
  const y = flatten(draft, bestX - 2, bestZ - 2, 5, 5, Block.Sandstone);
  for (let level = 1; level <= 4; level += 1) {
    for (let z = 0; z < 5; z += 1) {
      for (let x = 0; x < 5; x += 1) {
        const rim = x === 0 || z === 0 || x === 4 || z === 4;
        if (level < 4 || rim) place(draft, bestX - 2 + x, y + level, bestZ - 2 + z, Block.Sandstone);
      }
    }
  }
  place(draft, bestX - 2, y + 5, bestZ - 2, Block.Lantern);
  sign(draft, bestX, bestZ - 3, `${name}\nLookout`);
  draft.spawn = { x: bestX, y: y + 1, z: bestZ };
  for (let n = 0; n < 18; n += 1) {
    const x = 8 + Math.floor(hash01(n, 3, seed) * (size - 16));
    const z = 8 + Math.floor(hash01(n, 9, seed + 4) * (size - 16));
    if (draft.reserved[idx(draft, x, z)] || edgeDistance(draft, x, z) < 6) continue;
    if (slope(draft, x, z) > 1) continue;
    const ground = draft.heights[idx(draft, x, z)];
    let clear = true;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (draft.reserved[idx(draft, x + dx, z + dz)]) clear = false;
    }
    if (!clear) continue;
    reserve(draft, x, z);
    const tall = 1 + (hash01(x, z, seed) > 0.5 ? 1 : 0) + (hash01(x, z, seed + 1) > 0.75 ? 1 : 0);
    for (let i = 1; i <= tall; i += 1) place(draft, x, ground + i, z, Block.Cactus);
  }
  notes.push("Red sand over banded terracotta.");
  notes.push(`Sandstone lookout on the high shelf at y=${y}.`);
  notes.push("Cactus only where it has air on every side.");
}

function buildSnow(draft: Draft, seed: number, notes: string[], name: string) {
  const { size } = draft;
  const cx = Math.floor(size / 2);
  const cz = Math.floor(size / 2);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x / 30, z / 30, seed);
      let h = 64 + Math.round((n - 0.42) * 10);
      const dist = Math.hypot(x - cx, z - (cz + 6));
      let surface: BlockId = Block.Snow;
      if (dist < 8) {
        h = dist < 3 ? 62 : 63;
        surface = dist < 3 ? Block.BlueIce : Block.PackedIce;
      }
      h = Math.max(BASE_Y - 2, Math.min(78, blend(draft, x, z, h, 12)));
      if (edgeDistance(draft, x, z) <= 1) {
        h = BASE_Y;
        surface = Block.Grass;
      }
      setColumn(draft, x, z, h, surface);
    }
  }
  for (let dz = -7; dz <= 7; dz += 1) {
    for (let dx = -7; dx <= 7; dx += 1) {
      if (dx * dx + dz * dz <= 64) reserve(draft, cx + dx, cz + 6 + dz);
    }
  }
  const cabinX = Math.max(8, cx - 18);
  const cabinZ = Math.max(8, cz - 6);
  const floor = cabin(draft, cabinX, cabinZ, 7, 5, Block.SpruceLog, Block.SprucePlanks, Block.SpruceFence);
  paintPath(draft, cx, cz + 6, cabinX + 3, cabinZ, Block.Gravel);
  sign(draft, cx, cz + 2, `${name}\nFrozen pond`);
  draft.spawn = { x: cx, y: draft.heights[idx(draft, cx, cz)] + 1, z: cz };
  scatterTrees(draft, seed, "spruce", 0.035, (block) => block === Block.Snow);
  notes.push("Packed ice pond south of the meeting spot, blue ice in the center.");
  notes.push(`Spruce cabin to the west, floor at y=${floor}.`);
  notes.push("Gravel path between the pond and the door.");
}

function buildFestival(draft: Draft, seed: number, notes: string[], name: string) {
  const { size } = draft;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm(x / 34, z / 34, seed);
      const h = Math.max(BASE_Y, Math.min(68, blend(draft, x, z, 64 + Math.round((n - 0.5) * 4), 10)));
      setColumn(draft, x, z, h, Block.Grass);
    }
  }
  const cx = Math.floor(size / 2);
  const cz = Math.floor(size / 2);
  const y = flatten(draft, cx - 3, cz - 3, 7, 7, Block.SeaLantern);
  const lanes: { dx: number; dz: number; block: BlockId }[] = [
    { dx: 1, dz: 0, block: Block.RedWool },
    { dx: -1, dz: 0, block: Block.YellowWool },
    { dx: 0, dz: 1, block: Block.LimeWool },
    { dx: 0, dz: -1, block: Block.WhiteWool },
  ];
  for (const lane of lanes) {
    for (let step = 4; step < size / 2 - 2; step += 1) {
      for (let side = -1; side <= 1; side += 1) {
        const x = cx + lane.dx * step + lane.dz * side;
        const z = cz + lane.dz * step + lane.dx * side;
        if (!inside(draft, x, z) || draft.reserved[idx(draft, x, z)]) continue;
        if (draft.waterTop[idx(draft, x, z)] >= 0) continue;
        draft.surface[idx(draft, x, z)] = lane.block;
      }
    }
  }
  for (let z = cz - 3; z <= cz + 3; z += 1) {
    for (let x = cx - 3; x <= cx + 3; x += 1) {
      const rim = x === cx - 3 || x === cx + 3 || z === cz - 3 || z === cz + 3;
      const gate = z === cz + 3 && Math.abs(x - cx) <= 1;
      if (rim && !gate) place(draft, x, y + 1, z, Block.OakFence);
    }
  }
  for (const [dx, dz] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const) {
    place(draft, cx + dx, y + 2, cz + dz, Block.Lantern);
  }
  for (let n = 0; n < 40; n += 1) {
    const x = 6 + Math.floor(hash01(n, 1, seed) * (size - 12));
    const z = 6 + Math.floor(hash01(n, 2, seed + 5) * (size - 12));
    if (draft.reserved[idx(draft, x, z)]) continue;
    if (Math.abs(x - cx) <= 4 && Math.abs(z - cz) <= 4) continue;
    const ground = draft.heights[idx(draft, x, z)];
    place(draft, x, ground + 1, z, n % 2 === 0 ? Block.Hay : Block.Pumpkin);
    reserve(draft, x, z);
  }
  sign(draft, cx, cz + 4, `${name}\nStage`);
  draft.spawn = { x: cx, y: y + 1, z: cz };
  scatterTrees(draft, seed + 9, "oak", 0.012, (block) => block === Block.Grass);
  notes.push("Sea-lantern stage with a fence ring and an opening to the south.");
  notes.push("Four wool lanes: red, yellow, lime, and white.");
  notes.push("Hay bales and pumpkins in the grass around the stage.");
}

const BIOMES: Record<ThemeId, number> = {
  "pine-camp": 4,
  cove: 16,
  mesa: 37,
  snowfield: 12,
  festival: 1,
};

const BUILDERS = {
  "pine-camp": buildPine,
  cove: buildCove,
  mesa: buildMesa,
  snowfield: buildSnow,
  festival: buildFestival,
} as const;

function fillBelow(theme: ThemeId, y: number, height: number, surface: BlockId): BlockId {
  if (height === BASE_Y && surface === Block.Grass) {
    if (y >= 61) return Block.Dirt;
    return Block.Stone;
  }
  if (theme === "mesa") {
    if (y >= height - 1) return Block.RedSandstone;
    if (y >= 48) {
      const bands = [
        Block.OrangeTerracotta,
        Block.YellowTerracotta,
        Block.RedTerracotta,
        Block.WhiteTerracotta,
        Block.BrownTerracotta,
      ];
      return bands[Math.abs(y) % bands.length];
    }
    return Block.Stone;
  }
  if (theme === "cove" && (surface === Block.Sand || surface === Block.Gravel || surface === Block.Sandstone)) {
    if (y >= height - 3) return Block.Sand;
    return Block.Stone;
  }
  if (theme === "snowfield" && (surface === Block.Snow || surface === Block.PackedIce || surface === Block.BlueIce)) {
    if (y >= height - 2) return Block.Dirt;
    return Block.Stone;
  }
  if (y >= height - 3) return Block.Dirt;
  return Block.Stone;
}

export function blockAt(world: GeneratedWorld, x: number, y: number, z: number): BlockId {
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) {
    if (y === MIN_Y) return Block.Bedrock;
    if (y < MIN_Y || y > BASE_Y) return Block.Air;
    if (y === BASE_Y) return Block.Grass;
    if (y >= 61) return Block.Dirt;
    return Block.Stone;
  }
  const featured = world.featureIndex.get(posKey(x, y, z));
  if (featured !== undefined) return featured;
  if (y === MIN_Y) return Block.Bedrock;
  if (y < MIN_Y || y > 320) return Block.Air;
  const i = z * world.size + x;
  const height = world.heights[i];
  const water = world.waterTop[i];
  if (y > height) {
    if (water >= y && y > height) return Block.Water;
    return Block.Air;
  }
  if (y === height) return world.surface[i] as BlockId;
  return fillBelow(world.settings.theme, y, height, world.surface[i] as BlockId);
}

export type BlockCount = { id: BlockId; count: number };

/** Surface blocks, water, and placed features — the types you can see from above. */
export function blockCensus(world: GeneratedWorld): BlockCount[] {
  const counts = new Map<number, number>();
  const add = (id: BlockId) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (let i = 0; i < world.surface.length; i += 1) {
    add(world.surface[i] as BlockId);
    if (world.waterTop[i] >= 0) add(Block.Water);
  }
  for (const feature of world.features) add(feature.block);
  return [...counts.entries()]
    .map(([id, count]) => ({ id: id as BlockId, count }))
    .sort((a, b) => b.count - a.count || blockLabel(a.id).localeCompare(blockLabel(b.id)));
}

export function floorY(world: GeneratedWorld, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) return BASE_Y;
  const i = z * world.size + x;
  const limit = world.heights[i];
  for (let y = world.columnMax[i]; y >= limit; y -= 1) {
    const block = blockAt(world, x, y, z);
    if (block === Block.Air) continue;
    if (blockAt(world, x, y + 1, z) !== Block.Air) continue;
    if (block === Block.Water || blockAt(world, x, y + 2, z) === Block.Air) return y;
  }
  return limit;
}

export function generateWorld(settings: WorldSettings): GeneratedWorld {
  const size = SIZE_BLOCKS[settings.size];
  const draft = createDraft(size);
  const summary: string[] = [];
  BUILDERS[settings.theme](draft, settings.seed, summary, settings.name);
  sealEdges(draft);

  const features: WorldFeature[] = [];
  for (const [key, block] of draft.index) {
    const x = key % 256;
    const z = Math.floor(key / 256) % 256;
    const y = Math.floor(key / 65536) - 64;
    features.push({ x, y, z, block });
  }

  const columnMax = new Uint16Array(draft.heights);
  for (let i = 0; i < draft.waterTop.length; i += 1) {
    if (draft.waterTop[i] > columnMax[i]) columnMax[i] = draft.waterTop[i];
  }
  for (const feature of features) {
    const i = feature.z * size + feature.x;
    if (feature.y > columnMax[i]) columnMax[i] = feature.y;
  }

  const world: GeneratedWorld = {
    settings,
    size,
    biomeId: BIOMES[settings.theme],
    heights: draft.heights,
    surface: draft.surface,
    waterTop: draft.waterTop,
    columnMax,
    features,
    featureIndex: draft.index,
    signs: draft.signs,
    spawn: draft.spawn,
    summary,
  };

  let { x, z } = world.spawn;
  x = Math.max(2, Math.min(size - 3, x));
  z = Math.max(2, Math.min(size - 3, z));
  let y = floorY(world, x, z) + 1;
  while (y < 200 && (blockAt(world, x, y, z) !== Block.Air || blockAt(world, x, y + 1, z) !== Block.Air)) y += 1;
  world.spawn = { x, y, z };
  return world;
}
