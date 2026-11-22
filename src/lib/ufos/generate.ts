import { Block as B, type BlockId } from "@/lib/blocks";
import { seededRandom } from "@/lib/seeded-random";
import type { Voxel, VoxelPosition } from "@/lib/voxels";

import { civilizationFor, hullsFor, UFO_CONDITIONS, UFO_HULLS, type UfoCondition, type UfoRequest, type UfoHull, type XenosHull, type AsteroidHull } from "./catalog";
import { addClassicLandingGear, buildClassicHull, CLASSIC_HULLS } from "./classic";
import { buildXenosHull, withinXenosHull, XENOS_HULLS } from "./xenos";

import { addSalvage } from "./salvage";
import { buildInterior } from "./interior";

import { generateAsteroid } from "./asteroid";
import { columnKey, voxelKey, type Ufo } from "./scene";
export type { Ufo } from "./scene";

const SOIL = [B.CoarseDirt, B.Basalt, B.Stone] as const;
const XENOS_SOIL = [B.Basalt, B.RedTerracotta, B.Obsidian, B.RedTerracotta] as const;

function isXenosHull(hull: UfoHull): hull is XenosHull {
  return Object.hasOwn(XENOS_HULLS, hull);
}

type Ground = { x: number; z: number; y: number; block: BlockId };

export function generateUfo(options: UfoRequest = {}): Ufo {
  const seed = options.seed ?? Math.floor(Math.random() * 0x100000000);
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const requestedHull = options.hull === "any" ? undefined : options.hull;
  const civilization = options.civilization ?? (requestedHull ? civilizationFor(requestedHull) : "classic");
  const availableHulls = hullsFor(civilization);
  if (requestedHull && !availableHulls.includes(requestedHull)) {
    throw new RangeError("Choose a hull that belongs to the selected civilization.");
  }

  const randomHull = pick(availableHulls);
  const randomCondition = pick(Object.keys(UFO_CONDITIONS) as UfoCondition[]);
  const hull = requestedHull ?? randomHull;
  const condition = options.condition && options.condition !== "any" ? options.condition : randomCondition;
  if (civilization === "blight") return generateAsteroid(hull as AsteroidHull, condition, seed);
  const shipHull = hull as Exclude<UfoHull, AsteroidHull>;
  const organic = isXenosHull(shipHull);
  const profile = organic ? XENOS_HULLS[shipHull] : CLASSIC_HULLS[shipHull];
  const rx = profile.rx + 12 + Math.floor(random() * 6);
  const rz = profile.rz + 14 + Math.floor(random() * 6);
  const crash = condition !== "landed";
  const blastZ = 1 + Math.floor(random() * 3);
  const blastX = rx * 0.59;
  const lights = organic ? pick([B.Shroomlight, B.CryingObsidian]) : pick([B.SeaLantern, B.SeaLantern, B.Glowstone]);

  const deckY = (x: number, z: number) => {
    switch (condition) {
      case "landed": return 4;
      case "impact": return -2 + Math.floor(z * 0.29);
      case "skid": return Math.floor(x * 0.24) + 1;
      case "exploded": return Math.floor(x * 0.12);
    }
  };
  const power = organic ? 2 : CLASSIC_HULLS[shipHull].power;
  const within = (x: number, z: number, radius: number) => organic
    ? withinXenosHull(shipHull, x, z, rx, rz, radius)
    : (Math.abs(x) / rx) ** power + (Math.abs(z) / rz) ** power <= radius ** power;
  const cells = new Map<string, Voxel>();
  const set = (x: number, y: number, z: number, block: BlockId) => cells.set(voxelKey(x, y, z), { x, y, z, block });
  const paint = (x1: number, z1: number, x2: number, z2: number, y: number, block: BlockId) => {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) set(x, y, z, block);
  };

  if (organic) buildXenosHull(shipHull, rx, rz, within, set, !crash);
  else buildClassicHull(shipHull, rx, rz, within, set, lights);
  if (!organic && !crash) addClassicLandingGear(rx, rz, set, paint);
  const decks = buildInterior(
    civilization, rz, profile.trim, within, set, (x, y, z) => cells.delete(voxelKey(x, y, z)),
    seededRandom(seed ^ 0x8a531cef),
  );

  // Break the hull and furnishings together so the same material survives in both views.
  for (const [key, { x, y, z }] of cells) {
    const roughness = random();
    if (condition === "impact" && z < -rz * (0.67 + roughness * 0.09) && y >= 2 && Math.abs(x) < rx * 0.43) {
      cells.delete(key);
    }
    if (condition === "skid" && x < -rx * (0.67 + roughness * 0.15) && Math.abs(z - 2) < rz * 0.55 && y >= -1) {
      cells.delete(key);
    }
    if (condition === "exploded") {
      const blast = Math.hypot((x - blastX) / (rx * 0.59), (z - blastZ) / (rz * 0.66));
      if (x >= 2 + Math.floor(roughness * 3) && blast < 0.99 + roughness * 0.19) {
        cells.delete(key);
      } else if (x >= 3 && blast < 1.32 && roughness > 0.67 && y >= 0) {
        set(x, y, z, roughness > 0.94 ? (organic ? lights : B.Glowstone) : B.Basalt);
      }
    }
  }

  // Extend the rear threshold down to the surrounding field one block at a time.
  const rampTop = deckY(0, rz);
  const rampEnd = rz + Math.max(0, rampTop);
  for (let x = -1; x <= 1; x++) {
    for (let z = rz; z <= rampEnd; z++) {
      set(x, rampTop - (z - rz) - deckY(x, z), z, x === 0 && !organic ? B.LightGrayConcrete : profile.trim);
    }
  }

  const salvageRooms = decks.flatMap(({ y, rooms }) => rooms.map(({ x0, x1, z0, z1, use, door, side }) => {
    const positions: VoxelPosition[] = [];
    for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) positions.push({ x, y: y + 1, z });
    const entry = { x: door.x + (side ?? 0), y: y + 1, z: door.z - (side ? 0 : 1) };
    return { name: use[0], entry, positions };
  }));
  const chests = addSalvage(cells, salvageRooms, { civilization, condition, seed, area: rx * rz })
    .map((chest) => ({ ...chest, y: chest.y + deckY(chest.x, chest.z) }));

  const terrain = new Map<string, Ground>();
  const extentX = Math.ceil(rx * 1.68) + 3;
  const extentZ = Math.max(Math.ceil(rz * 1.69) + 3, rampEnd + 8);
  for (let x = -extentX; x <= extentX; x++) {
    for (let z = -extentZ; z <= extentZ; z++) {
      let y = -1;
      let block: BlockId = B.Grass;
      if (crash && !(z >= rampEnd && Math.abs(x) <= 2)) {
        const crater = condition === "impact"
          ? Math.hypot(x / (rx * 0.83), (z + rz * 0.59) / (rz * 0.98))
          : condition === "skid"
            ? Math.hypot((x + rx * 0.65) / (rx * 0.82), (z - rz * 0.5) / (rz * 1.16))
            : Math.hypot((x - blastX) / (rx * 1.08), (z - blastZ) / (rz * 1.04));
        const roughness = random();
        if (crater < 1 + roughness * 0.14) {
          y -= Math.max(0, Math.round((1 - crater) * (condition === "exploded" ? 8 : 5) + roughness));
          block = organic ? pick(XENOS_SOIL) : roughness < 0.57 ? B.CoarseDirt : pick(SOIL);
        }
        // Soil can cover the rim. Clear only the cabin and rear passage down to their deck.
        const insideRoom = decks[0].rooms.some(({ x0, x1, z0, z1 }) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
        if (insideRoom || within(x, z, 0.74) || (Math.abs(x) <= 2 && z >= 0 && z <= rampEnd)) {
          const floor = z >= rz && Math.abs(x) <= 1 ? rampTop - (z - rz) : deckY(x, z);
          if (floor <= y) {
            y = floor - 1;
            block = B.CoarseDirt;
          }
        }
      }
      terrain.set(columnKey(x, z), { x, y, z, block });
    }
  }
  const groundAt = (x: number, z: number) => terrain.get(columnKey(x, z))?.y ?? -1;

  const blocks = new Map<string, Voxel>();
  const place = (x: number, y: number, z: number, block: BlockId) => blocks.set(voxelKey(x, y, z), { x, y, z, block });
  const cutaways = decks.map(() => [] as Voxel[]);
  const organicHullColumns = new Set<string>();
  for (const cell of cells.values()) {
    const { x, y, z } = cell;
    const placed = { ...cell, y: y + deckY(x, z) };
    place(placed.x, placed.y, placed.z, placed.block);
    if (organic) organicHullColumns.add(columnKey(x, z));
    const deckIndex = Math.floor(y / 5);
    if (cutaways[deckIndex] && y <= decks[deckIndex].y + 3) {
      const inUpperDeck = deckIndex !== 1 || decks[1].rooms.some(({ x0, x1, z0, z1 }) =>
        x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1) || (Math.abs(x) <= 2 && z >= -10 && z <= 12);
      if (inUpperDeck) cutaways[deckIndex].push(placed);
    }
  }

  if (crash) {
    const count = condition === "exploded" ? 24 : 11;
    for (let index = 0; index < count; index++) {
      const angle = random() * Math.PI * 2;
      const spread = 1.04 + random() * 0.39;
      const x = Math.round(Math.cos(angle) * rx * spread);
      const z = Math.round(Math.sin(angle) * rz * spread);
      if (Math.abs(x) < 4 && z > 0) continue;
      const length = 1 + Math.floor(random() * (condition === "exploded" ? 5 : 3));
      const alongX = Math.abs(Math.sin(angle)) > 0.6;
      for (let offset = 0; offset < length; offset++) {
        const dx = x + (alongX ? offset : 0);
        const dz = z + (alongX ? 0 : offset);
        if (within(dx, dz, 1) || organicHullColumns.has(columnKey(dx, dz)) || (Math.abs(dx) < 4 && dz > 0)) continue;
        const y = groundAt(dx, dz) + 1;
        place(dx, y, dz, offset === 0 ? B.Basalt : pick([profile.hull, profile.trim, organic ? B.Quartz : B.GrayConcrete, lights]));
        if (offset === 1 && length >= 4) place(dx, y + 1, dz, profile.hull);
      }
    }
  }

  const terrainBlocks = new Map<string, Voxel>();
  const terrainPreview: Voxel[] = [];
  for (const { x, y, z, block } of terrain.values()) {
    terrainBlocks.set(voxelKey(x, y, z), { x, y, z, block });
    for (let air = y + 1; air <= -1; air++) terrainBlocks.set(voxelKey(x, air, z), { x, y: air, z, block: B.Air });
    terrainPreview.push({ x, y, z, block });
    const low = Math.min(groundAt(x - 1, z), groundAt(x + 1, z), groundAt(x, z - 1), groundAt(x, z + 1));
    for (let side = y - 1; side > low; side--) {
      terrainPreview.push({ x, y: side, z, block: side >= -4 ? B.Dirt : B.Stone });
    }
  }

  const visibleBlocks = new Map(terrainPreview.map((block) => [voxelKey(block.x, block.y, block.z), block]));
  for (const [key, block] of blocks) {
    terrainBlocks.set(key, block);
    // Wreckage below the local surface should remain buried in the exterior view.
    if (block.y >= groundAt(block.x, block.z)) visibleBlocks.set(key, block);
  }
  const deckViews = decks.map(({ name, y, rooms }, index) => ({
    name,
    cutaway: cutaways[index],
    rooms: rooms.map(({ x0, x1, z0, z1, use, door, side }) => {
      let missing = 0;
      let total = 0;
      for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) {
        total++;
        if (!cells.has(voxelKey(x, y, z))) missing++;
      }
      const x = door.x + (side ?? 0);
      const z = door.z - (side ? 0 : 1);
      return { name: use[0], x0, x1, z0, z1, entry: { x, y: y + deckY(x, z) + 1, z }, breached: missing > total * 0.25 };
    }),
  }));
  const spawn: VoxelPosition = { x: 0, y: 0, z: Math.max(rz + 9, rampEnd + 5) };

  return {
    seed, civilization, hull, condition, spawn, chests, decks: deckViews,
    title: `${UFO_HULLS[hull]} · ${UFO_CONDITIONS[condition]}`,
    blocks: [...terrainBlocks.values()],
    exterior: [...visibleBlocks.values()],
    width: 2 * (rx + (organic ? XENOS_HULLS[shipHull].widthExtension : 0)) + 1,
    length: rz * 2 + 1 + (organic ? XENOS_HULLS[shipHull].noseExtension : 0),
  };
}
