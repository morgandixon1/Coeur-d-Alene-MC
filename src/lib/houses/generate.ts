import { planRoofs } from "./roofs";
import { planHouse, type HousePlan } from "./plan";
import { buildHouse } from "./build";
import { generateOvertureHouse } from "./synthetic-overture";
import { Block as B, type BlockId } from "@/lib/blocks";
import { HOUSE_ERAS, HOUSE_PRICES, STYLE_TIERS, supportsTier, type HouseRequest, type HouseStyle } from "./catalog";

export type LootStack = { name: string; count: number };
export type LootLocation = "Pantry" | "Tool storage" | "Bedroom storage" | "Lake gear" | "Private safe";
export type HouseChest = { x: number; y: number; z: number; label: LootLocation; items: LootStack[] };
export type HouseBed = { x: number; y: number; z: number };
export type House = {
  plan: HousePlan;
  seed: number;
  request: HouseRequest & { seed: number };
  style: Style;
  era: Era;
  price: Price;
  title: string;
  badge: string;
  specs: string;
  materials: { wall: BlockId; accent: BlockId; trim: BlockId; roof: BlockId };
  blocks: { x: number; y: number; z: number; block: BlockId }[];
  floors: { cutY: number; floorY: number; rooms: string[] }[];
  spawn: { x: number; y: number; z: number };
  chests: HouseChest[];
  beds: HouseBed[];
  footprint?: {
    shape: string;
    bearingDeg: number | null;
    lengthM: number;
    widthM: number;
    cells: [number, number][];
  };
};

type Style = Exclude<HouseStyle, "any">;
type Era = Exclude<NonNullable<HouseRequest["era"]>, "any">;
type Price = Exclude<NonNullable<HouseRequest["price"]>, "any">;
type Palette = readonly [wall: BlockId, accent: BlockId, trim: BlockId, roof: BlockId];
type Profile = {
  palettes: readonly Palette[];
  name: string;
};

const PROFILES: Record<Style, Profile> = {
  manufactured: { name: "Manufactured home",
    palettes: [[B.WhiteTerracotta, B.LightGrayConcrete, B.Quartz, B.GrayConcrete], [B.YellowTerracotta, B.Stone, B.WhiteTerracotta, B.Stone], [B.LightGrayConcrete, B.GrayConcrete, B.WhiteTerracotta, B.GrayConcrete]] },
  ranch: { name: "North Idaho ranch",
    palettes: [[B.WhiteTerracotta, B.Brick, B.Quartz, B.GrayConcrete], [B.GreenTerracotta, B.Cobblestone, B.OakPlanks, B.Stone], [B.YellowTerracotta, B.BrownTerracotta, B.Quartz, B.GrayConcrete]] },
  suburban: { name: "Garage-front suburban",
    palettes: [
      [B.WhiteTerracotta, B.StoneBricks, B.Quartz, B.RoofTiles],
      [B.LightGrayConcrete, B.Brick, B.Quartz, B.RoofTiles],
      [B.GreenTerracotta, B.StoneBricks, B.Quartz, B.RoofTiles],
      [B.WhiteConcrete, B.Cobblestone, B.Quartz, B.RoofTiles],
    ] },
  craftsman: { name: "Inland Northwest craftsman",
    palettes: [[B.GreenTerracotta, B.Cobblestone, B.Quartz, B.GrayConcrete], [B.BrownTerracotta, B.StoneBricks, B.StrippedSpruce, B.BlackConcrete], [B.SprucePlanks, B.Basalt, B.Quartz, B.GrayConcrete]] },
  farmhouse: { name: "North Idaho modern farmhouse",
    palettes: [
      [B.WhiteConcrete, B.Cobblestone, B.BlackConcrete, B.BlackConcrete],
      [B.WhiteTerracotta, B.StoneBricks, B.BlackConcrete, B.BlackConcrete],
      [B.Quartz, B.Basalt, B.BlackConcrete, B.RoofTiles],
    ] },
  pnw_lodge: { name: "North Idaho timber lodge",
    palettes: [
      [B.StrippedSpruce, B.StoneBricks, B.SpruceLog, B.RoofTiles],
      [B.SprucePlanks, B.Cobblestone, B.SpruceLog, B.RoofTiles],
      [B.OakPlanks, B.StoneBricks, B.SpruceLog, B.RoofTiles],
    ] },
  pnw_modern: { name: "PNW lake modern",
    palettes: [
      [B.WhiteConcrete, B.StrippedSpruce, B.BlackConcrete, B.BlackConcrete],
      [B.GrayConcrete, B.StrippedSpruce, B.BlackConcrete, B.Basalt],
      [B.StrippedSpruce, B.Basalt, B.BlackConcrete, B.BlackConcrete],
    ] },
};

const LOOT: Record<LootLocation, readonly [item: string, min: number, max: number][]> = {
  Pantry: [["bread", 2, 7], ["apple", 1, 4], ["baked_potato", 2, 6], ["cooked_beef", 2, 5], ["golden_carrot", 2, 6]],
  "Tool storage": [["torch", 3, 10], ["oak_planks", 4, 14], ["stone_pickaxe", 1, 1], ["iron_ingot", 2, 5], ["iron_pickaxe", 1, 1]],
  "Bedroom storage": [["book", 1, 3], ["paper", 2, 6], ["compass", 1, 1], ["emerald", 1, 3], ["gold_ingot", 1, 3]],
  "Lake gear": [["fishing_rod", 1, 1], ["cooked_salmon", 2, 6], ["oak_boat", 1, 1], ["spyglass", 1, 1]],
  "Private safe": [["emerald", 2, 5], ["gold_ingot", 2, 6], ["diamond", 1, 2], ["golden_apple", 1, 1]],
};

const TRAILER_LOOT: Record<LootLocation, readonly [item: string, min: number, max: number][]> = {
  Pantry: [["rotten_flesh", 1, 3], ["potato", 1, 3], ["bowl", 1, 2], ["bread", 1, 2]],
  "Tool storage": [["stick", 2, 6], ["wooden_pickaxe", 1, 1], ["cobblestone", 2, 6], ["wooden_shovel", 1, 1]],
  "Bedroom storage": [["string", 1, 4], ["feather", 1, 3], ["paper", 1, 3], ["leather_boots", 1, 1]],
  "Lake gear": [["string", 1, 3], ["stick", 2, 4], ["cod", 1, 2], ["bowl", 1, 1]],
  "Private safe": [["coal", 1, 3], ["flint", 1, 2], ["bone", 1, 3], ["copper_ingot", 1, 2]],
};

const RANCH_LOOT: Record<LootLocation, readonly [item: string, min: number, max: number][]> = {
  Pantry: [["bread", 2, 5], ["apple", 1, 3], ["baked_potato", 2, 4], ["cooked_porkchop", 1, 3]],
  "Tool storage": [["torch", 4, 8], ["oak_planks", 4, 10], ["stone_pickaxe", 1, 1], ["coal", 3, 6], ["iron_ingot", 1, 2]],
  "Bedroom storage": [["book", 1, 2], ["paper", 2, 4], ["leather_tunic", 1, 1], ["torch", 2, 6]],
  "Lake gear": [["fishing_rod", 1, 1], ["cooked_cod", 1, 3], ["oak_boat", 1, 1], ["string", 2, 4]],
  "Private safe": [["coal", 3, 6], ["iron_ingot", 2, 4], ["copper_ingot", 2, 5], ["emerald", 1, 1]],
};

const MIX: readonly Style[] = ["manufactured", "manufactured", "ranch", "ranch", "ranch", "suburban", "suburban", "suburban", "craftsman", "farmhouse", "pnw_lodge", "pnw_modern"];
const TIERS: readonly Price[] = ["starter", "mid", "upscale", "luxury"];

export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createHouseLoot(style: Style, price: Price, seed: number): (label: LootLocation) => LootStack[] {
  const rank = TIERS.indexOf(price);
  const lootRandom = rng(seed ^ 0x71dd9a43);
  const lootInt = (min: number, max: number) => min + Math.floor(lootRandom() * (max - min + 1));
  const lootTable = style === "manufactured" ? TRAILER_LOOT : style === "ranch" ? RANCH_LOOT : LOOT;
  return (label: LootLocation): LootStack[] => {
    const pool = lootTable[label].slice(0, label === "Private safe" || label === "Lake gear" ? 4 : rank + 2);
    return pool.flatMap(([item, min, max], i) =>
      i === 0 || (label === "Private safe" && i === 2) || lootRandom() < 0.55
        ? [{ name: `minecraft:${item}`, count: lootInt(min, max) }] : []);
  };
}

export function resolveHouseMaterials(style: Style, era: Era, seed: number) {
  const random = rng(seed ^ 0x4b1d9c35);
  const profile = PROFILES[style];
  const [siding, accent, trim, defaultRoof] = profile.palettes[Math.floor(random() * profile.palettes.length)]!;
  const wall = era === "contemporary" && style === "suburban" ? B.LightGrayConcrete : siding;
  const usesSlabRoof = style === "suburban" || style === "ranch" || style === "craftsman";
  return { wall, accent, trim, roof: usesSlabRoof ? B.RoofTiles : defaultRoof, usesSlabRoof };
}

export function generateHouse(options: HouseRequest = {}): House {
  if (options.overture) return generateOvertureHouse(options);
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const request = { ...options, seed };
  const random = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  const requestedStyle = options.style ?? "any";
  const requestedPrice = options.price ?? "any";
  if (!supportsTier(requestedStyle, requestedPrice)) throw new RangeError("That home style is unavailable at the selected tier.");
  const style = requestedStyle === "any" ? pick(MIX.filter((value) => supportsTier(value, requestedPrice))) : requestedStyle;
  const price = requestedPrice === "any" ? pick(STYLE_TIERS[style]) : requestedPrice;
  const era = !options.era || options.era === "any" ? pick(["suburban90s", "contemporary"] as const) : options.era;
  const rank = TIERS.indexOf(price);
  const profile = PROFILES[style];
  const [siding, defaultAccent, defaultTrim, defaultRoof] = pick(profile.palettes);
  const defaultWall = era === "contemporary" && style === "suburban" ? B.LightGrayConcrete : siding;
  const usesSlabRoof = style === "suburban" || style === "ranch" || style === "craftsman";
  const wall = options.materials?.wall ?? defaultWall;
  const accent = options.materials?.accent ?? defaultAccent;
  const trim = options.materials?.trim ?? defaultTrim;
  const customRoof = options.materials?.roof !== undefined;
  const roofBlock = options.materials?.roof ?? (usesSlabRoof ? B.RoofTiles : defaultRoof);
  // Independent random streams keep edits in one layer from reshuffling another.
  const plan = planHouse(style, price, rng(seed ^ 0x176a3b21));
  plan.roofs = planRoofs(plan.volumes, style, rng(seed ^ 0x52ba198d), plan.envelopes);
  const lootRandom = rng(seed ^ 0x71dd9a43);
  const lootInt = (min: number, max: number) => min + Math.floor(lootRandom() * (max - min + 1));
  const lootTable = style === "manufactured" ? TRAILER_LOOT : style === "ranch" ? RANCH_LOOT : LOOT;
  const loot = (label: LootLocation): LootStack[] => {
    const pool = lootTable[label].slice(0, label === "Private safe" || label === "Lake gear" ? 4 : rank + 2);
    return pool.flatMap(([item, min, max], i) =>
      i === 0 || (label === "Private safe" && i === 2) || lootRandom() < 0.55
        ? [{ name: `minecraft:${item}`, count: lootInt(min, max) }] : []);
  };
  const built = buildHouse(plan, { style, rank, wall, accent, trim, roofBlock, customRoof }, rng(seed ^ 0x36ef2ab7), loot);
  const stories = Math.max(...plan.volumes.map(v => v.stories));
  return {
    ...built, plan, seed, request, style, era, price,
    materials: { wall, accent, trim, roof: roofBlock },
    title: `${profile.name} · ${plan.family}`,
    badge: `${HOUSE_ERAS[era]} · ${HOUSE_PRICES[price]}`,
    specs: `${stories} ${stories === 1 ? "story" : "stories"} · ${built.beds.length / 2} ${built.beds.length === 2 ? "bedroom" : "bedrooms"} · ${plan.roofs.length} main roof ${plan.roofs.length === 1 ? "section" : "sections"}`,
  };
}
