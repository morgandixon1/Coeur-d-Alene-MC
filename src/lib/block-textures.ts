import { CanvasTexture, NearestFilter, LinearFilter, SRGBColorSpace } from "three";
import { BLOCKS, Block, type BlockId } from "./blocks";

export type TextureMode = "pixel" | "smooth" | "flat";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgb(r: number, g: number, b: number, delta = 0, a = 1) {
  const rr = clamp(r + delta);
  const gg = clamp(g + delta);
  const bb = clamp(b + delta);
  return a < 1 ? `rgba(${rr},${gg},${bb},${a})` : `rgb(${rr},${gg},${bb})`;
}

type PatternKind =
  | "planks"
  | "log"
  | "stripped"
  | "brick"
  | "stone_bricks"
  | "cobble"
  | "roof_tiles"
  | "terracotta"
  | "concrete"
  | "quartz"
  | "basalt"
  | "glass"
  | "leaves"
  | "wool"
  | "stone"
  | "dirt"
  | "grass"
  | "door"
  | "chest"
  | "bookshelf"
  | "bright";

function patternFor(id: BlockId): PatternKind {
  switch (id) {
    case Block.OakPlanks:
    case Block.SprucePlanks:
    case Block.OakStairNorth:
    case Block.OakStairSouth:
    case Block.OakStairWest:
    case Block.OakFence:
    case Block.SpruceFence:
    case Block.OakSign:
    case Block.Ladder:
      return "planks";
    case Block.OakLog:
    case Block.SpruceLog:
      return "log";
    case Block.StrippedSpruce:
      return "stripped";
    case Block.Brick:
      return "brick";
    case Block.StoneBricks:
      return "stone_bricks";
    case Block.Cobblestone:
    case Block.MossyCobblestone:
      return "cobble";
    case Block.RoofSlab:
    case Block.RoofTiles:
      return "roof_tiles";
    case Block.WhiteTerracotta:
    case Block.YellowTerracotta:
    case Block.OrangeTerracotta:
    case Block.RedTerracotta:
    case Block.BrownTerracotta:
    case Block.GreenTerracotta:
    case Block.Sandstone:
    case Block.RedSandstone:
      return "terracotta";
    case Block.WhiteConcrete:
    case Block.LightGrayConcrete:
    case Block.GrayConcrete:
    case Block.BlackConcrete:
    case Block.YellowConcrete:
    case Block.Clay:
    case Block.Snow:
      return "concrete";
    case Block.Quartz:
    case Block.QuartzSlab:
      return "quartz";
    case Block.Basalt:
      return "basalt";
    case Block.Glass:
      return "glass";
    case Block.OakLeaves:
    case Block.SpruceLeaves:
    case Block.Moss:
      return "leaves";
    case Block.WhiteWool:
    case Block.RedWool:
    case Block.YellowWool:
    case Block.LimeWool:
    case Block.BedHead:
    case Block.BedFoot:
      return "wool";
    case Block.OakDoorLower:
    case Block.OakDoorUpper:
    case Block.OakDoorEastLower:
    case Block.OakDoorEastUpper:
      return "door";
    case Block.Chest:
    case Block.CraftingTable:
      return "chest";
    case Block.Bookshelf:
      return "bookshelf";
    case Block.Glowstone:
    case Block.SeaLantern:
    case Block.Lantern:
    case Block.Campfire:
      return "bright";
    case Block.Dirt:
    case Block.CoarseDirt:
    case Block.Podzol:
    case Block.Sand:
    case Block.RedSand:
    case Block.Gravel:
      return "dirt";
    case Block.Grass:
      return "grass";
    default:
      return "stone";
  }
}

function drawPixelTexture(ctx: CanvasRenderingContext2D, id: BlockId, base: [number, number, number]) {
  const [r, g, b] = base;
  const rand = mulberry32(id * 2654435761 + 17);
  const kind = patternFor(id);

  // Fill base noise first
  const px = (x: number, y: number, delta: number, alpha = 1) => {
    ctx.fillStyle = rgb(r, g, b, delta, alpha);
    ctx.fillRect(x, y, 1, 1);
  };

  if (kind === "glass") {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "rgba(180, 218, 232, 0.32)";
    ctx.fillRect(0, 0, 16, 16);
    // Crisp window frame border
    ctx.fillStyle = "rgba(235, 246, 250, 0.78)";
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(0, 0, 1, 16);
    ctx.fillRect(15, 0, 1, 16);
    // Diagonal reflection glints
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillRect(2, 2, 2, 1);
    ctx.fillRect(2, 3, 1, 2);
    ctx.fillRect(4, 3, 1, 1);
    ctx.fillRect(11, 11, 2, 1);
    ctx.fillRect(12, 10, 1, 1);
    return;
  }

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px(x, y, (rand() - 0.5) * 14);
    }
  }

  if (kind === "planks") {
    const seams = [0, 4, 8, 12];
    const joints = [7, 13, 3, 10];
    for (let y = 0; y < 16; y++) {
      const band = Math.floor(y / 4);
      const bandShift = (band % 2 === 0 ? 5 : -5);
      for (let x = 0; x < 16; x++) {
        const grain = Math.sin((x + band * 5) * 0.7) * 5 + (rand() - 0.5) * 10;
        px(x, y, bandShift + grain);
      }
      if (seams.includes(y)) {
        for (let x = 0; x < 16; x++) px(x, y, -32);
      } else if (seams.includes(y - 1)) {
        for (let x = 0; x < 16; x++) px(x, y, 12);
      }
    }
    for (let band = 0; band < 4; band++) {
      const jx = joints[band];
      for (let dy = 1; dy < 4; dy++) px(jx, band * 4 + dy, -28);
    }
  } else if (kind === "log" || kind === "stripped") {
    const contrast = kind === "log" ? 24 : 11;
    for (let x = 0; x < 16; x++) {
      const stripe = (rand() - 0.5) * contrast;
      for (let y = 0; y < 16; y++) {
        const knot = Math.sin(y * 0.6 + x * 1.4) * (contrast * 0.35);
        px(x, y, stripe + knot + (rand() - 0.5) * 10);
      }
    }
    if (kind === "log") {
      for (let x = 0; x < 16; x += 3) {
        for (let y = 0; y < 16; y++) {
          if (rand() < 0.65) px(x, y, -26);
        }
      }
    }
  } else if (kind === "brick") {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 4);
      const offset = (row % 2) * 4;
      const isMortarRow = y % 4 === 0;
      for (let x = 0; x < 16; x++) {
        const isMortarCol = (x + offset) % 8 === 0;
        if (isMortarRow || isMortarCol) {
          ctx.fillStyle = "rgb(186, 180, 170)";
          ctx.fillRect(x, y, 1, 1);
        } else {
          const brickTone = ((Math.floor((x + offset) / 8) + row * 3) % 3 - 1) * 10;
          px(x, y, brickTone + (rand() - 0.5) * 14);
        }
      }
    }
  } else if (kind === "stone_bricks") {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 8);
      const offset = row * 8;
      for (let x = 0; x < 16; x++) {
        if (y === 0 || y === 8 || (x + offset) % 16 === 0 || (x + offset) % 16 === 8) {
          px(x, y, -32);
        } else if (y === 1 || y === 9) {
          px(x, y, 14);
        } else {
          px(x, y, (rand() - 0.5) * 18);
        }
      }
    }
  } else if (kind === "cobble") {
    // Chunky irregular stone cells
    const cells = [
      [0, 0, 5, 5], [5, 0, 6, 4], [11, 0, 5, 6],
      [0, 5, 4, 6], [4, 4, 7, 5], [11, 6, 5, 5],
      [0, 11, 6, 5], [6, 9, 5, 7], [11, 11, 5, 5],
    ];
    for (const [cx, cy, cw, ch] of cells) {
      const tone = (rand() - 0.5) * 28;
      for (let y = cy; y < cy + ch; y++) {
        for (let x = cx; x < cx + cw; x++) {
          const edge = x === cx || y === cy;
          const highlight = x === cx + 1 && y === cy + 1;
          px(x, y, edge ? -30 : highlight ? tone + 18 : tone + (rand() - 0.5) * 12);
        }
      }
    }
    if (id === Block.MossyCobblestone) {
      for (let i = 0; i < 36; i++) {
        ctx.fillStyle = rgb(74, 118, 56, (rand() - 0.5) * 24);
        ctx.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 1);
      }
    }
  } else if (kind === "roof_tiles") {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 4);
      const offset = (row % 2) * 2;
      for (let x = 0; x < 16; x++) {
        if (y % 4 === 0) {
          px(x, y, -22);
        } else if ((x + offset) % 4 === 0) {
          px(x, y, -14);
        } else if (y % 4 === 1) {
          px(x, y, 10 + (rand() - 0.5) * 8);
        } else {
          px(x, y, (rand() - 0.5) * 12);
        }
      }
    }
  } else if (kind === "terracotta") {
    // Subtle plaster / lap-siding stucco warmth
    for (let y = 0; y < 16; y++) {
      const lap = y % 4 === 0 ? -9 : y % 4 === 1 ? 5 : 0;
      for (let x = 0; x < 16; x++) {
        px(x, y, lap + (rand() - 0.5) * 8);
      }
    }
  } else if (kind === "concrete") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        px(x, y, (rand() - 0.5) * 10);
      }
    }
  } else if (kind === "quartz") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const border = x === 0 || y === 0 || x === 15 || y === 15;
        px(x, y, border ? -12 : (rand() - 0.5) * 6);
      }
    }
  } else if (kind === "basalt") {
    for (let x = 0; x < 16; x++) {
      const col = (rand() - 0.5) * 20;
      for (let y = 0; y < 16; y++) {
        px(x, y, col + (rand() - 0.5) * 14);
      }
    }
  } else if (kind === "leaves") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = rand();
        px(x, y, v < 0.28 ? -32 : v > 0.78 ? 20 : (rand() - 0.5) * 14);
      }
    }
  } else if (kind === "wool") {
    // Paneled garage / fabric weave
    for (let y = 0; y < 16; y++) {
      const seam = y === 0 || y === 8;
      for (let x = 0; x < 16; x++) {
        const weave = ((x + y) % 2 === 0 ? 4 : -4) + (rand() - 0.5) * 8;
        px(x, y, seam ? -16 : weave);
      }
    }
  } else if (kind === "door") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const frame = x < 2 || x > 13 || y < 2 || y > 13;
        const inset = x >= 4 && x <= 11 && y >= 4 && y <= 11;
        px(x, y, frame ? -18 : inset ? -10 + (rand() - 0.5) * 8 : 8 + (rand() - 0.5) * 8);
      }
    }
    ctx.fillStyle = "rgb(214, 184, 92)";
    ctx.fillRect(11, 7, 2, 2);
  } else if (kind === "chest") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const border = x === 0 || x === 15 || y === 0 || y === 15 || y === 5;
        px(x, y, border ? -40 : (rand() - 0.5) * 12);
      }
    }
    ctx.fillStyle = "rgb(220, 198, 128)";
    ctx.fillRect(7, 4, 2, 3);
  } else if (kind === "bookshelf") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (y < 2 || y > 13 || y === 7 || y === 8) {
          px(x, y, (rand() - 0.5) * 12);
        } else {
          const spineColors = ["#8f332c", "#2f5d80", "#3a6e42", "#b38c36", "#6b477a", "#9c552e"];
          ctx.fillStyle = spineColors[(x * 3 + (y > 8 ? 2 : 0)) % spineColors.length];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  } else if (kind === "bright") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const border = x === 0 || x === 15 || y === 0 || y === 15;
        px(x, y, border ? -24 : (rand() - 0.3) * 26);
      }
    }
  } else if (kind === "grass") {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        px(x, y, (rand() - 0.5) * 26);
      }
    }
  } else {
    // Stone / dirt fallback
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        px(x, y, (rand() - 0.5) * 22);
      }
    }
  }
}

function drawSmoothTexture(ctx: CanvasRenderingContext2D, id: BlockId, base: [number, number, number]) {
  const [r, g, b] = base;
  const kind = patternFor(id);

  if (kind === "glass") {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(186, 222, 236, 0.34)";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(240, 248, 252, 0.72)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 61, 61);
    return;
  }

  ctx.fillStyle = rgb(r, g, b);
  ctx.fillRect(0, 0, 64, 64);

  if (kind === "planks" || kind === "terracotta") {
    // Clean architectural lap siding / horizontal courses
    const step = kind === "planks" ? 16 : 16;
    for (let y = 0; y < 64; y += step) {
      const grad = ctx.createLinearGradient(0, y, 0, y + step);
      grad.addColorStop(0, rgb(r, g, b, 8));
      grad.addColorStop(0.85, rgb(r, g, b, -4));
      grad.addColorStop(1, rgb(r, g, b, -22));
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 64, step);
    }
  } else if (kind === "roof_tiles") {
    for (let y = 0; y < 64; y += 16) {
      const grad = ctx.createLinearGradient(0, y, 0, y + 16);
      grad.addColorStop(0, rgb(r, g, b, 10));
      grad.addColorStop(1, rgb(r, g, b, -18));
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 64, 16);
      ctx.fillStyle = rgb(r, g, b, -26);
      ctx.fillRect(0, y + 15, 64, 1);
      const offset = ((y / 16) % 2) * 16;
      for (let x = offset; x < 64; x += 32) {
        ctx.fillRect(x, y, 1, 16);
      }
    }
  } else if (kind === "brick" || kind === "stone_bricks" || kind === "cobble") {
    const rh = kind === "brick" ? 16 : 32;
    const cw = kind === "brick" ? 32 : 32;
    for (let y = 0; y < 64; y += rh) {
      const offset = ((y / rh) % 2) * (cw / 2);
      ctx.fillStyle = kind === "brick" ? "rgba(195,188,176,0.85)" : rgb(r, g, b, -26);
      ctx.fillRect(0, y, 64, 2);
      for (let x = offset; x < 64; x += cw) {
        ctx.fillRect(x, y, 2, rh);
      }
    }
  } else if (kind === "log" || kind === "stripped" || kind === "basalt") {
    for (let x = 0; x < 64; x += 8) {
      ctx.fillStyle = rgb(r, g, b, x % 16 === 0 ? -12 : 6);
      ctx.fillRect(x, 0, 8, 64);
    }
  } else if (kind === "wool") {
    // Crisp garage panel ribs
    ctx.fillStyle = rgb(r, g, b, -16);
    ctx.fillRect(0, 0, 64, 2);
    ctx.fillRect(0, 32, 64, 2);
  } else {
    // Subtle architectural edge bevel
    ctx.strokeStyle = rgb(r, g, b, -12);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
  }
}

const cache = new Map<string, CanvasTexture>();

export function getBlockTexture(id: BlockId, mode: TextureMode): CanvasTexture | null {
  if (mode === "flat") return null;
  const key = `${mode}:${id}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const size = mode === "pixel" ? 16 : 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const base = BLOCKS[id].color;
  if (mode === "pixel") {
    drawPixelTexture(ctx, id, base);
  } else {
    drawSmoothTexture(ctx, id, base);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (mode === "pixel") {
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
  } else {
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
  }
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}
