import { Block as B, BLOCKS, type BlockId, type BlockState } from "@/lib/blocks";
import { STYLE_TIERS, type HouseEra, type HouseMaterialOverrides, type HousePrice, type HouseStyle } from "./catalog";
import { createHouseLoot, resolveHouseMaterials, rng, type HouseBed, type HouseChest } from "./generate";
import { bearingFromVector, type ProjectedFootprint } from "./footprint";

export type HeightAssumption = "source_height" | "source_floors" | "style_default";

export type CanonicalBlock = {
  x: number;
  y: number;
  z: number;
  name: string;
  states: BlockState[];
};

export type FittedHouseOptions = {
  groundY: (x: number, z: number) => number | null;
  style?: Exclude<HouseStyle, "any">;
  price?: Exclude<HousePrice, "any">;
  era?: Exclude<HouseEra, "any">;
  materials?: HouseMaterialOverrides;
  accessPoint?: { x: number; z: number } | null;
  nearestRoadPoint?: { x: number; z: number } | null;
  isBlockedExterior?: (x: number, z: number) => boolean;
};

export type FittedHouseResult = {
  id: string;
  seed: number;
  style: Exclude<HouseStyle, "any">;
  price: Exclude<HousePrice, "any">;
  era: Exclude<HouseEra, "any">;
  stories: number;
  storyHeight: number;
  heightAssumption: HeightAssumption;
  foundationY: number;
  frontBearingDeg: number | null;
  doorCell: { x: number; y: number; z: number } | null;
  spawn: { x: number; y: number; z: number };
  materials: { wall: BlockId; accent: BlockId; trim: BlockId; roof: BlockId };
  blocks: { x: number; y: number; z: number; block: BlockId }[];
  chests: HouseChest[];
  beds: HouseBed[];
};

const DIRS_4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Rotate a cardinal BlockId clockwise by `turns` (0..3) 90-degree increments. */
export function rotateBlockQuarterTurn(block: BlockId, turns: number): BlockId {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return block;
  if (t % 2 === 1) {
    if (block === B.OakDoorLower) return B.OakDoorEastLower;
    if (block === B.OakDoorUpper) return B.OakDoorEastUpper;
    if (block === B.OakDoorEastLower) return B.OakDoorLower;
    if (block === B.OakDoorEastUpper) return B.OakDoorUpper;
  }
  const stairCycle: BlockId[] = [B.OakStairNorth, B.OakStairWest, B.OakStairSouth, B.OakStairWest];
  const idx = stairCycle.indexOf(block);
  if (idx !== -1) {
    if (block === B.OakStairNorth) return t === 2 ? B.OakStairSouth : B.OakStairWest;
    if (block === B.OakStairSouth) return t === 2 ? B.OakStairNorth : B.OakStairWest;
    if (block === B.OakStairWest) return t === 1 ? B.OakStairNorth : t === 3 ? B.OakStairSouth : B.OakStairWest;
  }
  return block;
}

/**
 * Rotate a coordinate + block + entity set by exact 90-degree clockwise increments around (pivotX, pivotZ).
 * Useful when aligning an axis-aligned house plan onto a quarter-turned site.
 */
export function rotateQuarterTurn(
  input: {
    blocks: { x: number; y: number; z: number; block: BlockId }[];
    chests: HouseChest[];
    beds: HouseBed[];
  },
  turns: number,
  pivotX = 0,
  pivotZ = 0,
): {
  blocks: { x: number; y: number; z: number; block: BlockId }[];
  chests: HouseChest[];
  beds: HouseBed[];
} {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return input;
  const rotXZ = (x: number, z: number): [number, number] => {
    const dx = x - pivotX;
    const dz = z - pivotZ;
    if (t === 1) return [pivotX - dz, pivotZ + dx];
    if (t === 2) return [pivotX - dx, pivotZ - dz];
    return [pivotX + dz, pivotZ - dx];
  };
  return {
    blocks: input.blocks.map(({ x, y, z, block }) => {
      const [rx, rz] = rotXZ(x, z);
      return { x: rx, y, z: rz, block: rotateBlockQuarterTurn(block, t) };
    }),
    chests: input.chests.map((chest) => {
      const [rx, rz] = rotXZ(chest.x, chest.z);
      return { ...chest, x: rx, z: rz };
    }),
    beds: input.beds.map((bed) => {
      const [rx, rz] = rotXZ(bed.x, bed.z);
      return { ...bed, x: rx, z: rz };
    }),
  };
}

/** Convert repository BlockId voxels to canonical Bedrock block names and typed states. */
export function toCanonicalBlocks(
  blocks: readonly { x: number; y: number; z: number; block: BlockId }[],
): CanonicalBlock[] {
  return blocks.map(({ x, y, z, block }) => {
    const def = BLOCKS[block];
    return { x, y, z, name: def.name, states: def.states };
  });
}

function chooseStyleForFootprint(
  footprint: ProjectedFootprint,
  random: () => number,
): Exclude<HouseStyle, "any"> {
  const area = footprint.cells.length;
  const { lengthM, widthM } = footprint.envelope;
  const aspect = widthM > 0 ? lengthM / widthM : 1;
  if (area <= 95 && aspect >= 1.8) return "manufactured";
  if (area <= 150) return random() < 0.5 ? "ranch" : "suburban";
  if (area <= 260) {
    const pool: Exclude<HouseStyle, "any">[] = ["suburban", "ranch", "craftsman", "farmhouse"];
    return pool[Math.floor(random() * pool.length)]!;
  }
  const largePool: Exclude<HouseStyle, "any">[] = ["craftsman", "pnw_lodge", "pnw_modern"];
  return largePool[Math.floor(random() * largePool.length)]!;
}

function deriveStories(
  footprint: ProjectedFootprint,
  style: Exclude<HouseStyle, "any">,
  storyHeight: number,
  random: () => number,
): { stories: number; heightAssumption: HeightAssumption } {
  const height = footprint.properties.height;
  if (typeof height === "number" && Number.isFinite(height) && height > 0) {
    const stories = Math.max(1, Math.min(3, Math.round(height / storyHeight)));
    return { stories, heightAssumption: "source_height" };
  }
  const floors = footprint.properties.num_floors;
  if (typeof floors === "number" && Number.isFinite(floors) && floors > 0) {
    const stories = Math.max(1, Math.min(3, Math.round(floors)));
    return { stories, heightAssumption: "source_floors" };
  }
  if (style === "manufactured" || style === "ranch") {
    return { stories: 1, heightAssumption: "style_default" };
  }
  if (style === "farmhouse") {
    return { stories: 2, heightAssumption: "style_default" };
  }
  const stories = footprint.cells.length >= 160 && random() < 0.55 ? 2 : 1;
  return { stories, heightAssumption: "style_default" };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Fit and build a complete Minecraft house directly onto a projected Overture footprint mask.
 * Preserves concavities (L-notches), courtyard holes, and disconnected MultiPolygon components.
 */
export function buildFootprintHouse(
  footprint: ProjectedFootprint,
  options: FittedHouseOptions,
): FittedHouseResult {
  const seed = footprint.seed >>> 0;
  const random = rng(seed ^ 0x2f6e2b1);
  const style = options.style ?? chooseStyleForFootprint(footprint, random);
  const allowedPrices = STYLE_TIERS[style];
  const price = options.price ?? allowedPrices[Math.floor(random() * allowedPrices.length)]!;
  const era: Exclude<HouseEra, "any"> = options.era ?? (random() < 0.5 ? "suburban90s" : "contemporary");
  const storyHeight = style === "pnw_modern" || style === "pnw_lodge" ? 5 : 4;
  const { stories, heightAssumption } = deriveStories(footprint, style, storyHeight, random);
  const baseMats = resolveHouseMaterials(style, era, seed);
  const wall = options.materials?.wall ?? baseMats.wall;
  const accent = options.materials?.accent ?? baseMats.accent;
  const trim = options.materials?.trim ?? baseMats.trim;
  const customRoof = options.materials?.roof !== undefined;
  const roofBlock = options.materials?.roof ?? baseMats.roof;
  const usesSlabRoof = baseMats.usesSlabRoof && !(customRoof && roofBlock !== B.RoofTiles && roofBlock !== B.RoofSlab);
  const loot = createHouseLoot(style, price, seed);
  const rank = ["starter", "mid", "upscale", "luxury"].indexOf(price);
  const lightBlock = rank > 1 ? B.SeaLantern : B.Glowstone;

  const groundSamples: number[] = [];
  const localGround = new Map<string, number>();
  for (const [x, z] of footprint.cells) {
    const gy = options.groundY(x, z);
    if (gy !== null) {
      groundSamples.push(gy);
      localGround.set(`${x},${z}`, gy);
    }
  }
  const foundationY = groundSamples.length > 0 ? median(groundSamples) : 64;

  const cells = new Map<string, BlockId>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, b: BlockId | null) => {
    if (b === null) cells.delete(key(x, y, z));
    else cells.set(key(x, y, z), b);
  };

  const chests: HouseChest[] = [];
  const beds: HouseBed[] = [];
  let frontBearingDeg: number | null = null;
  let primaryDoor: { x: number; y: number; z: number } | null = null;
  let spawn = { x: Math.round(footprint.envelope.centerX), y: foundationY, z: Math.round(footprint.envelope.centerZ) };

  const nonEmptyComponents = footprint.components
    .filter((comp) => comp.length > 0)
    .sort((a, b) => b.length - a.length);

  const roofShape = typeof footprint.properties.roof_shape === "string"
    ? footprint.properties.roof_shape.toLowerCase()
    : null;
  const isFlatRoof = roofShape === "flat" || style === "pnw_modern";
  const roofPitch = style === "manufactured" || style === "ranch" ? 3 : 2;

  for (let compIndex = 0; compIndex < nonEmptyComponents.length; compIndex += 1) {
    const comp = nonEmptyComponents[compIndex]!;
    const compStories = compIndex === 0 ? stories : 1;
    const mask = new Set(comp.map(([x, z]) => `${x},${z}`));
    const hasCell = (x: number, z: number) => mask.has(`${x},${z}`);

    const boundarySet = new Set<string>();
    const interiorCells: [number, number][] = [];
    for (const [x, z] of comp) {
      const missingCount = DIRS_4.filter(([dx, dz]) => !hasCell(x + dx, z + dz)).length;
      if (missingCount > 0) boundarySet.add(`${x},${z}`);
      else interiorCells.push([x, z]);
    }

    // BFS inward from boundary cells to shape stepped roofs cleanly over L-shapes & courtyards.
    const edgeDist = new Map<string, number>();
    const distQueue: [number, number][] = [];
    for (const [x, z] of comp) {
      const k = `${x},${z}`;
      if (boundarySet.has(k)) {
        edgeDist.set(k, 0);
        distQueue.push([x, z]);
      }
    }
    for (let i = 0; i < distQueue.length; i += 1) {
      const [x, z] = distQueue[i]!;
      const d = edgeDist.get(`${x},${z}`)!;
      for (const [dx, dz] of DIRS_4) {
        const nx = x + dx;
        const nz = z + dz;
        const nk = `${nx},${nz}`;
        if (!mask.has(nk) || edgeDist.has(nk)) continue;
        edgeDist.set(nk, d + 1);
        distQueue.push([nx, nz]);
      }
    }

    // Collect true polygon shell vertices so oblique stair-stepped walls don't get striped with corner trim.
    const shellVertices: [number, number][] = [];
    for (const poly of footprint.polygons) {
      const shell = poly[0];
      if (!shell) continue;
      for (let vi = 0; vi < shell.length - 1; vi += 1) shellVertices.push(shell[vi]!);
    }

    // 1. Foundation skirt, floors, exterior walls, windows, and ceilings.
    for (const [x, z] of comp) {
      const k = `${x},${z}`;
      const isBoundary = boundarySet.has(k);
      const gy = localGround.get(k) ?? foundationY;
      for (let fy = gy; fy < foundationY; fy += 1) {
        set(x, fy, z, accent);
      }
      set(x, foundationY, z, isBoundary ? accent : B.OakPlanks);

      if (isBoundary) {
        const isCorner = shellVertices.some(([vx, vz]) => Math.hypot(x + 0.5 - vx, z + 0.5 - vz) <= 1.05);
        const isSuburban = style === "suburban";
        const isFarmhouse = style === "farmhouse";
        const isLodge = style === "pnw_lodge";
        const isModern = style === "pnw_modern";
        // Regular window rhythm along both axis-aligned and oblique walls.
        const wallPhase = (((x + z) % 4) + 4) % 4;
        const modernPhase = (((x + z) % 5) + 5) % 5;
        const windowPattern = isModern ? modernPhase !== 0 && !isCorner : (wallPhase === 1 || wallPhase === 2) && !isCorner;
        const lodgeTimberPost = isLodge && wallPhase === 0 && !isCorner;
        const modernSteelMullion = isModern && modernPhase === 0 && !isCorner;

        for (let s = 0; s < compStories; s += 1) {
          const baseY = foundationY + s * storyHeight;
          for (let dy = 1; dy < storyHeight; dy += 1) {
            const isWindowY = isLodge || isModern
              ? dy >= 1 && dy <= storyHeight - 2
              : isSuburban || isFarmhouse
                ? dy >= 2 && dy <= 3
                : dy >= 2 && dy < storyHeight - 1;
            let block: BlockId;
            if (isCorner || lodgeTimberPost || modernSteelMullion) {
              block = isSuburban && s === 0 && dy === 1 ? accent : trim;
            } else if (isLodge && dy === storyHeight - 1) {
              // Heavy horizontal timber tie-beam at the top of each story.
              block = B.StrippedSpruce;
            } else if (isModern && dy === storyHeight - 1) {
              // Warm cedar soffit/fascia ribbon contrasting against matte-black steel & glass.
              block = B.StrippedSpruce;
            } else if (windowPattern && isWindowY) {
              block = B.Glass;
            } else if (isSuburban && s === 0 && dy === 1) {
              block = windowPattern ? B.Quartz : accent;
            } else if (isSuburban && s > 0 && dy === 1 && windowPattern) {
              block = B.Quartz;
            } else if (isFarmhouse && dy === 1 && windowPattern) {
              block = trim;
            } else {
              block = wall;
            }
            set(x, baseY + dy, z, block);
          }
          if (s > 0) set(x, baseY, z, isSuburban ? B.Quartz : isFarmhouse || isLodge ? B.StrippedSpruce : isModern ? trim : wall);
        }
      } else {
        for (let s = 1; s < compStories; s += 1) {
          set(x, foundationY + s * storyHeight, z, B.OakPlanks);
        }
      }

      // Continuous ceiling at top wall plate.
      const ceilingY = foundationY + compStories * storyHeight;
      set(x, ceilingY, z, B.WhiteWool);
    }

    // 2. Stepped roof strictly within mask (never fills courtyards, notches, or conflict zones).
    const topWallY = foundationY + compStories * storyHeight;
    const roofHeights = new Map<string, number>();
    for (const [x, z] of comp) {
      const k = `${x},${z}`;
      const d = edgeDist.get(k) ?? 0;
      const rise = isFlatRoof ? 0 : Math.min(4, Math.floor(d / roofPitch));
      const ry = topWallY + rise;
      roofHeights.set(k, ry);
      for (let fy = topWallY + 1; fy < ry; fy += 1) {
        set(x, fy, z, wall);
      }
      if (isFlatRoof) {
        if (style === "pnw_modern") {
          // Architectural parapet rim + recessed glass skylight over the center of the great room.
          const isSkylight = d >= 3 && Math.abs(x - Math.round(footprint.envelope.centerX)) <= 2 && Math.abs(z - Math.round(footprint.envelope.centerZ)) <= 2;
          set(x, ry, z, d === 0 ? trim : isSkylight ? B.Glass : roofBlock);
          if (d === 0) set(x, ry + 1, z, trim);
        } else {
          set(x, ry, z, d === 0 ? trim : roofBlock);
        }
      } else if (style === "pnw_lodge") {
        // Warm timber fascia outlining the dark slate lodge roof.
        set(x, ry, z, d === 0 ? B.OakPlanks : roofBlock);
      } else if (usesSlabRoof) {
        set(x, ry, z, d % roofPitch === 0 ? B.RoofSlab : B.RoofTiles);
      } else {
        set(x, ry, z, d === 0 && style !== "farmhouse" ? trim : roofBlock);
      }
    }

    // Timber lodge signature: tall stone fireplace chimney rising 3 blocks above the roof ridge.
    if (style === "pnw_lodge" && compIndex === 0) {
      const chimCandidates = comp
        .filter(([x, z]) => boundarySet.has(`${x},${z}`))
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const chim = chimCandidates[Math.floor(chimCandidates.length / 2)];
      if (chim) {
        const [cx, cz] = chim;
        const maxRoofY = Math.max(...roofHeights.values());
        for (let cy = foundationY; cy <= maxRoofY + 2; cy += 1) {
          set(cx, cy, cz, accent);
        }
      }
    }

    // 3. Entrance door selection & outward frontBearingDeg.
    type DoorCandidate = { x: number; z: number; ox: number; oz: number; ix: number; iz: number; score: number };
    const doorCandidates: DoorCandidate[] = [];
    const targetBearing =
      footprint.envelope.axisBearingDeg !== null ? (footprint.envelope.axisBearingDeg + 90) % 360 : 180;

    for (const [x, z] of comp) {
      if (!boundarySet.has(`${x},${z}`)) continue;
      for (const [dx, dz] of DIRS_4) {
        const ox = x + dx;
        const oz = z + dz;
        const ix = x - dx;
        const iz = z - dz;
        if (hasCell(ox, oz) || !hasCell(ix, iz) || boundarySet.has(`${ix},${iz}`)) continue;
        if (options.isBlockedExterior?.(ox, oz)) continue;

        let score = 0;
        if (options.accessPoint) {
          score = -Math.hypot(ox - options.accessPoint.x, oz - options.accessPoint.z);
        } else if (options.nearestRoadPoint) {
          score = -Math.hypot(ox - options.nearestRoadPoint.x, oz - options.nearestRoadPoint.z);
        } else {
          const outBearing = bearingFromVector(dx, dz);
          const diff = Math.abs(((outBearing - targetBearing + 540) % 360) - 180);
          const distCenter = Math.hypot(x - footprint.envelope.centerX, z - footprint.envelope.centerZ);
          score = -diff - distCenter * 0.15;
        }
        doorCandidates.push({ x, z, ox, oz, ix, iz, score });
      }
    }
    doorCandidates.sort((a, b) => b.score - a.score || a.z - b.z || a.x - b.x);
    const chosenDoor = doorCandidates[0];

    if (chosenDoor) {
      const sideDoor = chosenDoor.ox !== chosenDoor.x;
      set(chosenDoor.x, foundationY + 1, chosenDoor.z, sideDoor ? B.OakDoorEastLower : B.OakDoorLower);
      set(chosenDoor.x, foundationY + 2, chosenDoor.z, sideDoor ? B.OakDoorEastUpper : B.OakDoorUpper);
      if (style === "suburban") {
        set(chosenDoor.x, foundationY + 3, chosenDoor.z, B.Quartz);
      } else if (style === "farmhouse") {
        set(chosenDoor.x, foundationY + 3, chosenDoor.z, B.StrippedSpruce);
      }
      if (compIndex === 0) {
        frontBearingDeg = bearingFromVector(chosenDoor.ox - chosenDoor.x, chosenDoor.oz - chosenDoor.z);
        primaryDoor = { x: chosenDoor.x, y: foundationY + 1, z: chosenDoor.z };
        spawn = {
          x: chosenDoor.ox + (chosenDoor.ox - chosenDoor.x),
          y: foundationY,
          z: chosenDoor.oz + (chosenDoor.oz - chosenDoor.z),
        };
      }
    }

    // Suburban signature: paneled white garage door with glass transoms and stone piers on the street face.
    if (style === "suburban" && chosenDoor && (nonEmptyComponents.length === 1 ? compIndex === 0 : compIndex === 1)) {
      const outDx = chosenDoor.ox - chosenDoor.x;
      const outDz = chosenDoor.oz - chosenDoor.z;
      const sameFace = comp
        .filter(([x, z]) => {
          if (!boundarySet.has(`${x},${z}`)) return false;
          if (hasCell(x + outDx, z + outDz)) return false;
          if (compIndex === 0 && Math.hypot(x - chosenDoor.x, z - chosenDoor.z) < 3.2) return false;
          return true;
        })
        .sort((a, b) => (outDx === 0 ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0]));

      if (sameFace.length >= 4) {
        const span = Math.min(5, Math.max(3, sameFace.length - 2));
        const start = Math.floor((sameFace.length - span) / 2);
        const bayCells = sameFace.slice(start, start + span);
        for (const [bi, [bx, bz]] of bayCells.entries()) {
          set(bx, foundationY + 1, bz, B.WhiteConcrete);
          set(bx, foundationY + 2, bz, B.WhiteConcrete);
          set(bx, foundationY + 3, bz, bi % 2 === 1 ? B.Glass : B.WhiteConcrete);
        }
        // Flanking stone/brick piers on either side of the garage bay.
        for (const pier of [sameFace[start - 1], sameFace[start + span]]) {
          if (!pier) continue;
          for (let dy = 0; dy <= 3; dy += 1) set(pier[0], foundationY + dy, pier[1], accent);
        }
      }
    }

    // 4. Flush ceiling / wall lights (never protruding into room air).
    const lightSpacing = 6;
    for (let s = 0; s < compStories; s += 1) {
      const baseY = foundationY + s * storyHeight;
      const ceilingY = baseY + storyHeight;
      let placedLight = false;
      if (s === compStories - 1) {
        for (const [x, z] of interiorCells) {
          if (Math.abs(x) % lightSpacing === 0 && Math.abs(z) % lightSpacing === 0) {
            if ((roofHeights.get(`${x},${z}`) ?? topWallY) > ceilingY) {
              set(x, ceilingY, z, lightBlock);
              placedLight = true;
            }
          }
        }
        if (!placedLight) {
          const covered = interiorCells.find(([x, z]) => (roofHeights.get(`${x},${z}`) ?? topWallY) > ceilingY);
          if (covered) {
            set(covered[0], ceilingY, covered[1], lightBlock);
            placedLight = true;
          }
        }
      }
      if (!placedLight) {
        // Integrate flush into top wall row (above doors and windows).
        const wallY = baseY + storyHeight - 1;
        const wallCandidate = comp.find(([x, z]) => {
          if (!boundarySet.has(`${x},${z}`)) return false;
          const b = cells.get(key(x, wallY, z));
          return b !== undefined && b !== B.Glass;
        });
        if (wallCandidate) set(wallCandidate[0], wallY, wallCandidate[1], lightBlock);
      }
    }

    // 5. BFS-reachable interior partitioning & rich multi-floor furnishing.
    const startCell: [number, number] | undefined = chosenDoor
      ? [chosenDoor.ix, chosenDoor.iz]
      : interiorCells[0];
    const reachable: [number, number][] = [];
    const stairReserved = new Set<string>();
    const reserved = new Set<string>();
    if (chosenDoor) {
      reserved.add(`${chosenDoor.x},${chosenDoor.z}`);
      reserved.add(`${chosenDoor.ix},${chosenDoor.iz}`);
    }

    if (startCell) {
      const visited = new Set<string>([`${startCell[0]},${startCell[1]}`]);
      const queue: [number, number][] = [startCell];
      for (let i = 0; i < queue.length; i += 1) {
        const [qx, qz] = queue[i]!;
        reachable.push([qx, qz]);
        for (const [dx, dz] of DIRS_4) {
          const nx = qx + dx;
          const nz = qz + dz;
          const nk = `${nx},${nz}`;
          if (visited.has(nk) || !mask.has(nk) || boundarySet.has(nk)) continue;
          visited.add(nk);
          queue.push([nx, nz]);
        }
      }
    }

    // Interior staircase for multi-story components (kept clear of walls & doors).
    let stairInfo: { sx: number; sz: number } | null = null;
    if (compStories > 1 && reachable.length >= storyHeight + 4) {
      const reachSet = new Set(reachable.map(([x, z]) => `${x},${z}`));
      const stairRun = reachable.find(([x, z]) => {
        for (let i = 0; i <= storyHeight + 1; i += 1) {
          if (!reachSet.has(`${x + i},${z}`) || reserved.has(`${x + i},${z}`)) return false;
        }
        return true;
      });
      if (stairRun) {
        const [sx, sz] = stairRun;
        stairInfo = { sx, sz };
        for (let i = 0; i < storyHeight; i += 1) {
          const x = sx + storyHeight - i;
          set(x, foundationY + i + 1, sz, B.OakStairWest);
          for (let cy = foundationY + i + 2; cy <= foundationY + storyHeight + 2; cy += 1) {
            set(x, cy, sz, null);
          }
          reserved.add(`${x},${sz}`);
          stairReserved.add(`${x},${sz}`);
        }
        reserved.add(`${sx},${sz}`);
        reserved.add(`${sx + storyHeight + 1},${sz}`);
        stairReserved.add(`${sx},${sz}`);
        stairReserved.add(`${sx + storyHeight + 1},${sz}`);
        // Stairwell guardrail on Floor 2 along the side of the opening.
        const railBlock = style === "pnw_modern" ? B.Glass : style === "pnw_lodge" || style === "farmhouse" ? B.SpruceFence : B.OakFence;
        for (let i = 1; i <= storyHeight; i += 1) {
          const rx = sx + i;
          for (const rz of [sz - 1, sz + 1]) {
            if (reachSet.has(`${rx},${rz}`) && !stairReserved.has(`${rx},${rz}`)) {
              set(rx, foundationY + storyHeight + 1, rz, railBlock);
              stairReserved.add(`${rx},${rz}`);
              break;
            }
          }
        }
      }
    }

    // Add interior partition walls with doorways on spacious floors so rooms feel real, not warehouse-empty.
    const isLodge = style === "pnw_lodge";
    const isModern = style === "pnw_modern";
    const partitionBlock = isLodge ? B.SprucePlanks : isModern ? B.WhiteConcrete : wall;
    const floorPlank = isLodge ? B.SprucePlanks : isModern ? B.SprucePlanks : B.OakPlanks;
    if (isLodge || isModern) {
      for (const [x, z] of interiorCells) {
        for (let s = 0; s < compStories; s += 1) {
          if (s > 0 && stairReserved.has(`${x},${z}`) && !cells.has(key(x, foundationY + s * storyHeight, z))) continue;
          set(x, foundationY + s * storyHeight, z, floorPlank);
        }
      }
    }

    const reachSet = new Set(reachable.map(([x, z]) => `${x},${z}`));
    const minIX = reachable.length ? Math.min(...reachable.map(([x]) => x)) : 0;
    const maxIX = reachable.length ? Math.max(...reachable.map(([x]) => x)) : 0;
    const minIZ = reachable.length ? Math.min(...reachable.map(([, z]) => z)) : 0;
    const maxIZ = reachable.length ? Math.max(...reachable.map(([, z]) => z)) : 0;
    const spanIX = maxIX - minIX + 1;
    const spanIZ = maxIZ - minIZ + 1;

    const placeInteriorPartitions = (storyIdx: number, blocked: Set<string>) => {
      if (reachable.length < 36 || Math.max(spanIX, spanIZ) < 7) return;
      const baseY = foundationY + storyIdx * storyHeight;
      const splitVert = spanIX >= spanIZ;
      const mid = splitVert ? Math.floor((minIX + maxIX) / 2) : Math.floor((minIZ + maxIZ) / 2);
      const lineCells = reachable
        .filter(([x, z]) => (splitVert ? x === mid : z === mid))
        .sort((a, b) => (splitVert ? a[1] - b[1] : a[0] - b[0]));
      if (lineCells.length < 4) return;
      // Skip if the partition would bisect the stair opening.
      if (lineCells.some(([x, z]) => stairReserved.has(`${x},${z}`))) return;
      const doorIdx = Math.floor(lineCells.length / 2);
      for (let i = 0; i < lineCells.length; i += 1) {
        const [px, pz] = lineCells[i]!;
        const pk = `${px},${pz}`;
        if (blocked.has(pk)) continue;
        blocked.add(pk);
        if (i === doorIdx) {
          // Doorway connecting the partitioned rooms (and keep adjacent clearance free).
          set(px, baseY + 1, pz, splitVert ? B.OakDoorEastLower : B.OakDoorLower);
          set(px, baseY + 2, pz, splitVert ? B.OakDoorEastUpper : B.OakDoorUpper);
          for (let dy = 3; dy < storyHeight; dy += 1) set(px, baseY + dy, pz, partitionBlock);
          for (const [dx, dz] of DIRS_4) blocked.add(`${px + dx},${pz + dz}`);
        } else {
          for (let dy = 1; dy < storyHeight; dy += 1) set(px, baseY + dy, pz, partitionBlock);
        }
      }
    };

    const floor1Blocked = new Set<string>(reserved);
    placeInteriorPartitions(0, floor1Blocked);

    // Helper to build sorted candidate spots for a given story.
    const makeSpotPicker = (storyIdx: number, blocked: Set<string>) => {
      const baseY = foundationY + storyIdx * storyHeight;
      const floorY = baseY + 1;
      const candidates = reachable
        .filter(([x, z]) => !blocked.has(`${x},${z}`) && !cells.has(key(x, floorY, z)) && cells.has(key(x, baseY, z)))
        .sort((a, b) => {
          const aAdj = DIRS_4.filter(([dx, dz]) => boundarySet.has(`${a[0] + dx},${a[1] + dz}`)).length;
          const bAdj = DIRS_4.filter(([dx, dz]) => boundarySet.has(`${b[0] + dx},${b[1] + dz}`)).length;
          return bAdj - aAdj || a[1] - b[1] || a[0] - b[0];
        });
      const available = new Set(candidates.map(([x, z]) => `${x},${z}`));

      const take = (near?: [number, number]): [number, number] | null => {
        const list = candidates.filter(([x, z]) => available.has(`${x},${z}`) && !blocked.has(`${x},${z}`));
        if (near) {
          list.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]));
        }
        const pick = list[0];
        if (!pick) return null;
        available.delete(`${pick[0]},${pick[1]}`);
        blocked.add(`${pick[0]},${pick[1]}`);
        return pick;
      };

      const takePairZ = (): [number, number] | null => {
        const head = candidates.find(
          ([x, z]) =>
            available.has(`${x},${z}`) &&
            available.has(`${x},${z + 1}`) &&
            !blocked.has(`${x},${z}`) &&
            !blocked.has(`${x},${z + 1}`) &&
            cells.has(key(x, baseY, z + 1)),
        );
        if (!head) return null;
        const [bx, bz] = head;
        available.delete(`${bx},${bz}`);
        available.delete(`${bx},${bz + 1}`);
        blocked.add(`${bx},${bz}`);
        blocked.add(`${bx},${bz + 1}`);
        return head;
      };

      const placeChestAt = (spot: [number, number] | null, label: "Pantry" | "Tool storage" | "Bedroom storage" | "Lake gear" | "Private safe") => {
        if (!spot || cells.has(key(spot[0], floorY + 1, spot[1]))) return false;
        set(spot[0], floorY, spot[1], B.Chest);
        chests.push({ x: spot[0], y: floorY, z: spot[1], label, items: loot(label) });
        return true;
      };

      const placeBed = () => {
        const head = takePairZ();
        if (!head) return false;
        const [bx, bz] = head;
        set(bx, floorY, bz, B.BedHead);
        set(bx, floorY, bz + 1, B.BedFoot);
        beds.push({ x: bx, y: floorY, z: bz }, { x: bx, y: floorY, z: bz + 1 });
        return true;
      };

      return { baseY, floorY, candidates, available, take, takePairZ, placeChestAt, placeBed };
    };

    // --- Floor 1 furnishing ---
    const f1 = makeSpotPicker(0, floor1Blocked);

    // 1a. Architectural fireplace hearth & glowing campfire (lodge, modern, craftsman, farmhouse)
    if (compIndex === 0 && (isLodge || isModern || style === "craftsman" || style === "farmhouse") && reachable.length >= 24) {
      const hearth = f1.take();
      if (hearth) {
        set(hearth[0], f1.floorY, hearth[1], B.Campfire);
        const surround = f1.take(hearth);
        if (surround) {
          const hearthMat = isModern ? B.Basalt : accent;
          set(surround[0], f1.floorY, surround[1], hearthMat);
          set(surround[0], f1.floorY + 1, surround[1], hearthMat);
          if (isModern) set(surround[0], f1.floorY + 2, surround[1], B.Basalt);
        }
      }
    }

    // 1b. Great room / Living room seating (sofa + coffee table + area rug + modern media wall)
    if (compIndex === 0 && reachable.length >= 16) {
      const sofa1 = f1.take();
      if (sofa1) {
        const sofaBlock = isLodge ? B.RedWool : B.WhiteWool;
        set(sofa1[0], f1.floorY, sofa1[1], sofaBlock);
        const sofa2 = f1.take(sofa1);
        if (sofa2) set(sofa2[0], f1.floorY, sofa2[1], sofaBlock);
        if (isModern) {
          const sofa3 = f1.take(sofa1);
          if (sofa3) set(sofa3[0], f1.floorY, sofa3[1], sofaBlock);
          const media = f1.take();
          if (media) {
            set(media[0], f1.floorY, media[1], B.BlackConcrete);
            set(media[0], f1.floorY + 1, media[1], B.BlackConcrete);
          }
        }
        const table = f1.take(sofa1);
        if (table) set(table[0], f1.floorY, table[1], isLodge ? B.SprucePlanks : B.QuartzSlab);
        // Cozy floor rug near the sofa (recessed into floor so it never blocks walking)
        for (const [dx, dz] of DIRS_4) {
          const rx = sofa1[0] + dx;
          const rz = sofa1[1] + dz;
          if (reachSet.has(`${rx},${rz}`) && !floor1Blocked.has(`${rx},${rz}`)) {
            set(rx, f1.baseY, rz, isLodge ? B.RedWool : isModern ? B.LightGrayConcrete : B.WhiteWool);
          }
        }
      }
    }

    // 1c. Kitchen / dining cluster (furnace, crafting table, waterfall counters, pantry & lake gear chests)
    const furnaceSpot = f1.take();
    if (furnaceSpot) {
      set(furnaceSpot[0], f1.floorY, furnaceSpot[1], B.Furnace);
      const tableSpot = f1.take(furnaceSpot);
      if (tableSpot) set(tableSpot[0], f1.floorY, tableSpot[1], B.CraftingTable);
      const counter1 = f1.take(furnaceSpot);
      if (counter1) set(counter1[0], f1.floorY, counter1[1], isLodge ? B.StoneBricks : B.Quartz);
      if (isModern) {
        const island = f1.take(furnaceSpot);
        if (island) set(island[0], f1.floorY, island[1], B.Quartz);
      }
      f1.placeChestAt(f1.take(furnaceSpot), compIndex === 0 ? "Pantry" : "Tool storage");
    } else {
      f1.placeChestAt(f1.take(), compIndex === 0 ? "Pantry" : "Tool storage");
    }
    if (isModern && compIndex === 0 && reachable.length >= 20) {
      f1.placeChestAt(f1.take(), "Lake gear");
    }

    if (compIndex === 0 && reachable.length >= 28) {
      const diningCenter = f1.take();
      if (diningCenter) {
        set(diningCenter[0], f1.floorY, diningCenter[1], floorPlank);
        const chair1 = f1.take(diningCenter);
        if (chair1) set(chair1[0], f1.floorY, chair1[1], B.OakStairSouth);
        const chair2 = f1.take(diningCenter);
        if (chair2) set(chair2[0], f1.floorY, chair2[1], B.OakStairNorth);
      }
    }

    // 1d. Ground-floor bedroom (for 1-story homes) or study/bookshelves (for 2-story homes)
    if (compStories === 1 && (compIndex === 0 || reachable.length >= 12)) {
      f1.placeBed();
      const shelf = f1.take();
      if (shelf) set(shelf[0], f1.floorY, shelf[1], B.Bookshelf);
      if (compIndex === 0 && reachable.length >= 16) {
        f1.placeChestAt(f1.take(), style === "manufactured" ? "Bedroom storage" : "Tool storage");
      }
    } else if (compStories > 1 && compIndex === 0) {
      const shelf1 = f1.take();
      if (shelf1) {
        set(shelf1[0], f1.floorY, shelf1[1], B.Bookshelf);
        set(shelf1[0], f1.floorY + 1, shelf1[1], B.Bookshelf);
      }
      const shelf2 = f1.take(shelf1 ?? undefined);
      if (shelf2) set(shelf2[0], f1.floorY, shelf2[1], B.Bookshelf);
    }

    // --- Floor 2+ furnishing (upstairs bedrooms, bookshelves, chests, loft seating) ---
    for (let s = 1; s < compStories; s += 1) {
      const floorBlocked = new Set<string>(stairReserved);
      if (stairInfo) {
        floorBlocked.add(`${stairInfo.sx},${stairInfo.sz}`);
        floorBlocked.add(`${stairInfo.sx - 1},${stairInfo.sz}`);
      }
      placeInteriorPartitions(s, floorBlocked);
      const fs = makeSpotPicker(s, floorBlocked);

      // Primary upstairs bedroom
      const placedPrimary = fs.placeBed();
      if (placedPrimary) {
        const shelf = fs.take();
        if (shelf) {
          set(shelf[0], fs.floorY, shelf[1], B.Bookshelf);
          set(shelf[0], fs.floorY + 1, shelf[1], B.Bookshelf);
        }
        const label = rank === 3 ? "Private safe" : "Bedroom storage";
        fs.placeChestAt(fs.take(), label);
      }

      // Second upstairs bedroom on spacious upper floors
      if (reachable.length >= 32) {
        if (fs.placeBed()) {
          const shelf = fs.take();
          if (shelf) set(shelf[0], fs.floorY, shelf[1], B.Bookshelf);
        }
      }

      // Loft / reading nook
      const loftSeat = fs.take();
      if (loftSeat) {
        set(loftSeat[0], fs.floorY, loftSeat[1], isLodge ? B.RedWool : B.WhiteWool);
        const desk = fs.take(loftSeat);
        if (desk) set(desk[0], fs.floorY, desk[1], floorPlank);
      }
    }
  }

  const blocks = [...cells.entries()].map(([k, block]) => {
    const [x, y, z] = k.split(",").map(Number);
    return { x, y, z, block };
  });

  return {
    id: footprint.id,
    seed,
    style,
    price,
    era,
    stories,
    storyHeight,
    heightAssumption,
    foundationY,
    frontBearingDeg,
    doorCell: primaryDoor,
    spawn,
    materials: { wall, accent, trim, roof: roofBlock },
    blocks,
    chests,
    beds,
  };
}
