import { Block as B, type BlockId } from "@/lib/blocks";
import { rng } from "@/lib/houses/generate";
import { buildCommercial } from "./build";
import {
  COMMERCIAL_ERAS,
  COMMERCIAL_SCALES,
  COMMERCIAL_STORE_TYPES,
  TYPE_SCALES,
  supportsScale,
  type CommercialEra,
  type CommercialRequest,
  type CommercialScale,
  type CommercialStoreType,
  type CommercialType,
} from "./catalog";
import { planCommercial, type CommercialPlan } from "./plan";

export type LootStack = { name: string; count: number };
export type CommercialLootLocation =
  | "Cash register"
  | "Front aisle"
  | "Backroom stock"
  | "Employee breakroom"
  | "Supply room"
  | "Commercial kitchen"
  | "Parts & tools"
  | "Manager safe"
  | "Shipping crate";

export type CommercialChest = {
  x: number;
  y: number;
  z: number;
  label: CommercialLootLocation;
  items: LootStack[];
};

export type CommercialBed = { x: number; y: number; z: number };

export type CommercialBuilding = {
  plan: CommercialPlan;
  seed: number;
  request: CommercialRequest & { seed: number };
  type: ResolvedType;
  era: ResolvedEra;
  scale: ResolvedScale;
  storeType: ResolvedStoreType;
  title: string;
  badge: string;
  specs: string;
  materials: { wall: BlockId; accent: BlockId; trim: BlockId; roof: BlockId };
  blocks: { x: number; y: number; z: number; block: BlockId }[];
  floors: { cutY: number; floorY: number; rooms: string[] }[];
  spawn: { x: number; y: number; z: number };
  chests: CommercialChest[];
  beds: CommercialBed[];
};

type ResolvedType = Exclude<CommercialType, "any">;
type ResolvedEra = Exclude<CommercialEra, "any">;
type ResolvedScale = Exclude<CommercialScale, "any">;
export type ResolvedStoreType = Exclude<CommercialStoreType, "any">;

type Palette = readonly [wall: BlockId, accent: BlockId, trim: BlockId, roof: BlockId, awning: BlockId];

type Profile = {
  name: string;
  palettes: Record<ResolvedEra, readonly Palette[]>;
};

// White Concrete main outline (`trim`) with grey-only stone/concrete/basalt/tile textures
// for walls, accents, and roofs (no wood or wool on the building shell).
// Canopies (`awning`) can be any color, striped or solid.
const GREY_PALETTES = {
  stoneBrickRedCanopy: [B.StoneBricks, B.GrayConcrete, B.WhiteConcrete, B.RoofTiles, B.RedWool],
  stoneBrickLimeCanopy: [B.StoneBricks, B.Cobblestone, B.WhiteConcrete, B.GrayConcrete, B.LimeWool],
  concreteSlateYellowCanopy: [B.LightGrayConcrete, B.GrayConcrete, B.WhiteConcrete, B.Basalt, B.YellowWool],
  concreteSlateRedCanopy: [B.LightGrayConcrete, B.StoneBricks, B.WhiteConcrete, B.RoofTiles, B.RedTerracotta],
  basaltDarkOrangeCanopy: [B.Basalt, B.GrayConcrete, B.WhiteConcrete, B.RoofTiles, B.OrangeTerracotta],
  basaltDarkGreenCanopy: [B.Basalt, B.Stone, B.WhiteConcrete, B.GrayConcrete, B.GreenTerracotta],
  stoneClayBlueCanopy: [B.Clay, B.Stone, B.WhiteConcrete, B.GrayConcrete, B.BlueIce],
  stoneClayYellowCanopy: [B.Stone, B.Cobblestone, B.WhiteConcrete, B.RoofTiles, B.YellowConcrete],
  charcoalBlackCanopy: [B.GrayConcrete, B.Basalt, B.WhiteConcrete, B.RoofTiles, B.BlackConcrete],
  lightConcreteGrayCanopy: [B.LightGrayConcrete, B.Clay, B.WhiteConcrete, B.GrayConcrete, B.GrayConcrete],
} as const satisfies Record<string, Palette>;

const PROFILES: Record<ResolvedType, Profile> = {
  sherman_storefront: {
    name: "Sherman Ave storefront",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.stoneClayYellowCanopy, GREY_PALETTES.basaltDarkGreenCanopy],
      midcentury: [GREY_PALETTES.concreteSlateYellowCanopy, GREY_PALETTES.stoneBrickLimeCanopy, GREY_PALETTES.stoneClayBlueCanopy],
      contemporary: [GREY_PALETTES.basaltDarkOrangeCanopy, GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.concreteSlateRedCanopy],
    },
  },
  strip_plaza: {
    name: "Highway 95 strip plaza",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.stoneClayYellowCanopy],
      midcentury: [GREY_PALETTES.concreteSlateYellowCanopy, GREY_PALETTES.lightConcreteGrayCanopy, GREY_PALETTES.stoneBrickLimeCanopy],
      contemporary: [GREY_PALETTES.concreteSlateRedCanopy, GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.stoneClayBlueCanopy],
    },
  },
  cafe_diner: {
    name: "North Idaho coffeehouse",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.basaltDarkGreenCanopy],
      midcentury: [GREY_PALETTES.concreteSlateYellowCanopy, GREY_PALETTES.basaltDarkOrangeCanopy, GREY_PALETTES.stoneBrickLimeCanopy],
      contemporary: [GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.stoneClayBlueCanopy, GREY_PALETTES.concreteSlateRedCanopy],
    },
  },
  office_midrise: {
    name: "Riverstone office",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.stoneClayBlueCanopy],
      midcentury: [GREY_PALETTES.lightConcreteGrayCanopy, GREY_PALETTES.concreteSlateYellowCanopy],
      contemporary: [GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.basaltDarkOrangeCanopy, GREY_PALETTES.stoneClayBlueCanopy],
    },
  },
  warehouse: {
    name: "Industrial warehouse",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.stoneClayYellowCanopy],
      midcentury: [GREY_PALETTES.lightConcreteGrayCanopy, GREY_PALETTES.concreteSlateYellowCanopy],
      contemporary: [GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.basaltDarkGreenCanopy, GREY_PALETTES.concreteSlateRedCanopy],
    },
  },
  auto_shop: {
    name: "Auto & marine service",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.stoneClayYellowCanopy],
      midcentury: [GREY_PALETTES.concreteSlateRedCanopy, GREY_PALETTES.concreteSlateYellowCanopy],
      contemporary: [GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.basaltDarkOrangeCanopy],
    },
  },
  lakefront_lodge: {
    name: "Lakefront lodge & brewery",
    palettes: {
      historic: [GREY_PALETTES.stoneBrickRedCanopy, GREY_PALETTES.basaltDarkGreenCanopy],
      midcentury: [GREY_PALETTES.stoneClayYellowCanopy, GREY_PALETTES.stoneBrickLimeCanopy],
      contemporary: [GREY_PALETTES.charcoalBlackCanopy, GREY_PALETTES.stoneClayBlueCanopy, GREY_PALETTES.basaltDarkGreenCanopy],
    },
  },
};

const STORE_LOOT: Record<ResolvedStoreType, readonly [item: string, min: number, max: number][]> = {
  grocery: [
    ["bread", 4, 12],
    ["apple", 3, 10],
    ["baked_potato", 4, 10],
    ["cooked_beef", 2, 8],
    ["cooked_salmon", 2, 6],
    ["carrot", 4, 12],
    ["melon_slice", 4, 12],
    ["pumpkin_pie", 2, 6],
  ],
  clothing: [
    ["leather_helmet", 1, 1],
    ["leather_chestplate", 1, 1],
    ["leather_leggings", 1, 1],
    ["leather_boots", 1, 1],
    ["white_wool", 4, 12],
    ["string", 4, 12],
    ["leather", 3, 8],
    ["iron_boots", 1, 1],
  ],
  hardware: [
    ["iron_pickaxe", 1, 1],
    ["iron_axe", 1, 1],
    ["iron_shovel", 1, 1],
    ["iron_ingot", 3, 10],
    ["copper_ingot", 4, 12],
    ["torch", 6, 18],
    ["redstone", 4, 12],
    ["fishing_rod", 1, 1],
    ["compass", 1, 2],
  ],
  pharmacy: [
    ["glass_bottle", 4, 12],
    ["sugar", 4, 12],
    ["honeycomb", 2, 8],
    ["glistering_melon_slice", 2, 6],
    ["golden_apple", 1, 2],
    ["paper", 4, 12],
    ["book", 1, 4],
    ["clock", 1, 1],
  ],
};

const COMMERCIAL_LOOT: Record<
  Exclude<CommercialLootLocation, "Front aisle" | "Backroom stock">,
  readonly [item: string, min: number, max: number][]
> = {
  "Cash register": [
    ["emerald", 2, 7],
    ["paper", 3, 9],
    ["gold_nugget", 4, 12],
    ["gold_ingot", 1, 3],
  ],
  "Employee breakroom": [
    ["bread", 2, 5],
    ["apple", 2, 4],
    ["baked_potato", 2, 5],
    ["paper", 2, 6],
  ],
  "Supply room": [
    ["paper", 4, 12],
    ["book", 1, 4],
    ["torch", 4, 12],
    ["iron_ingot", 2, 6],
  ],
  "Commercial kitchen": [
    ["bread", 3, 9],
    ["cooked_beef", 2, 6],
    ["baked_potato", 3, 8],
    ["apple", 2, 6],
    ["golden_carrot", 1, 4],
  ],
  "Parts & tools": [
    ["iron_ingot", 2, 6],
    ["copper_ingot", 3, 8],
    ["coal", 4, 10],
    ["iron_pickaxe", 1, 1],
    ["redstone", 3, 8],
  ],
  "Manager safe": [
    ["emerald", 4, 10],
    ["gold_ingot", 2, 6],
    ["diamond", 1, 2],
    ["book", 1, 3],
  ],
  "Shipping crate": [
    ["brick", 6, 16],
    ["iron_ingot", 2, 6],
    ["coal", 4, 12],
    ["stone_bricks", 8, 20],
    ["torch", 6, 16],
  ],
};

const MIX: readonly ResolvedType[] = [
  "sherman_storefront",
  "sherman_storefront",
  "strip_plaza",
  "strip_plaza",
  "cafe_diner",
  "office_midrise",
  "office_midrise",
  "warehouse",
  "auto_shop",
  "lakefront_lodge",
];

const SCALES: readonly ResolvedScale[] = ["small", "medium", "large"];
const ERAS: readonly ResolvedEra[] = ["historic", "midcentury", "contemporary"];
const STORE_TYPES: readonly ResolvedStoreType[] = ["grocery", "clothing", "hardware", "pharmacy"];

export function generateCommercial(options: CommercialRequest = {}): CommercialBuilding {
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const request = { ...options, seed };
  const random = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;

  const requestedType = options.type ?? "any";
  const requestedScale = options.scale ?? "any";
  if (!supportsScale(requestedType, requestedScale)) {
    throw new RangeError("That commercial building type is unavailable at the selected scale.");
  }

  const type =
    requestedType === "any"
      ? pick(MIX.filter((value) => supportsScale(value, requestedScale)))
      : requestedType;
  const scale = requestedScale === "any" ? pick(TYPE_SCALES[type]) : requestedScale;
  const era = !options.era || options.era === "any" ? pick(ERAS) : options.era;
  const storeType =
    !options.storeType || options.storeType === "any" ? pick(STORE_TYPES) : options.storeType;
  const rank = SCALES.indexOf(scale);

  const profile = PROFILES[type];
  const paletteChoices = profile.palettes[era];
  const [defaultWall, defaultAccent, defaultTrim, defaultRoof, awningBlock] = pick(paletteChoices);

  const wall = options.materials?.wall ?? defaultWall;
  const accent = options.materials?.accent ?? defaultAccent;
  const trim = options.materials?.trim ?? defaultTrim;
  const roofBlock = options.materials?.roof ?? defaultRoof;

  const plan = planCommercial(type, scale, rng(seed ^ 0x243f6a88));

  const lootRandom = rng(seed ^ 0x71dd9a43);
  const lootInt = (min: number, max: number) => min + Math.floor(lootRandom() * (max - min + 1));
  const loot = (label: CommercialLootLocation): LootStack[] => {
    if (label === "Front aisle" || label === "Backroom stock") {
      const storePool = STORE_LOOT[storeType];
      if (label === "Backroom stock") {
        // Backroom chests are fully stocked with the same store-type items as the front
        return storePool.map(([item, min, max]) => ({
          name: `minecraft:${item}`,
          count: lootInt(min, Math.min(64, max * 2)),
        }));
      }
      // Front aisle chest gets a focused subset of 2–4 store-type items
      const startIdx = Math.floor(lootRandom() * storePool.length);
      const count = 2 + Math.floor(lootRandom() * 3);
      const picked: LootStack[] = [];
      for (let i = 0; i < count; i++) {
        const [item, min, max] = storePool[(startIdx + i) % storePool.length]!;
        picked.push({ name: `minecraft:${item}`, count: lootInt(min, max) });
      }
      return picked;
    }
    const pool = COMMERCIAL_LOOT[label].slice(0, Math.min(COMMERCIAL_LOOT[label].length, rank + 3));
    return pool.flatMap(([item, min, max], i) =>
      i === 0 || (label === "Manager safe" && i === 1) || lootRandom() < 0.6
        ? [{ name: `minecraft:${item}`, count: lootInt(min, max) }]
        : [],
    );
  };

  const built = buildCommercial(
    plan,
    { type, storeType, rank, wall, accent, trim, roofBlock, awningBlock },
    rng(seed ^ 0x85a308d3),
    loot,
  );

  const stories = Math.max(...plan.volumes.map((v) => v.stories));
  const totalSpaces = plan.volumes.reduce((sum, v) => sum + v.stories, 0);
  const bayNote = plan.bayDoors.length > 0 ? ` · ${plan.bayDoors.length} service ${plan.bayDoors.length === 1 ? "bay" : "bays"}` : "";

  return {
    ...built,
    plan,
    seed,
    request,
    type,
    era,
    scale,
    storeType,
    materials: { wall, accent, trim, roof: roofBlock },
    title: `${profile.name} · ${COMMERCIAL_STORE_TYPES[storeType]}`,
    badge: `${COMMERCIAL_ERAS[era]} · ${COMMERCIAL_SCALES[scale]} · ${plan.family}`,
    specs: `${stories} ${stories === 1 ? "story" : "stories"} · ${totalSpaces} ${totalSpaces === 1 ? "space" : "spaces"}${bayNote}`,
  };
}
