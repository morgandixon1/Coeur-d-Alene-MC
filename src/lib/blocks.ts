export const Block = {
  Air: 0,
  Bedrock: 1,
  Stone: 2,
  Dirt: 3,
  Grass: 4,
  Sand: 5,
  Gravel: 6,
  Water: 7,
  OakLog: 8,
  OakLeaves: 9,
  SpruceLog: 10,
  SpruceLeaves: 11,
  OakPlanks: 12,
  SprucePlanks: 13,
  Cobblestone: 14,
  MossyCobblestone: 15,
  Glass: 16,
  Sandstone: 17,
  RedSand: 18,
  RedSandstone: 19,
  OrangeTerracotta: 20,
  RedTerracotta: 21,
  YellowTerracotta: 22,
  WhiteTerracotta: 23,
  BrownTerracotta: 24,
  Snow: 25,
  PackedIce: 26,
  BlueIce: 27,
  CoarseDirt: 28,
  Podzol: 29,
  Moss: 30,
  Glowstone: 31,
  SeaLantern: 32,
  Hay: 33,
  Pumpkin: 34,
  OakFence: 35,
  SpruceFence: 36,
  Lantern: 37,
  Campfire: 38,
  Cactus: 39,
  OakSign: 40,
  WhiteWool: 41,
  RedWool: 42,
  YellowWool: 43,
  LimeWool: 44,
  Clay: 45,
  LightGrayConcrete: 46,
  GrayConcrete: 47,
  YellowConcrete: 48,
  Brick: 49,
  StoneBricks: 50,
  Chest: 51,
  Furnace: 52,
  CraftingTable: 53,
  Bookshelf: 54,
  OakDoorLower: 55,
  OakDoorUpper: 56,
  Ladder: 57,
  OakDoorEastLower: 58,
  OakDoorEastUpper: 59,
  OakStairWest: 60,
  OakStairNorth: 61,
  OakStairSouth: 62,
  BedHead: 63,
  BedFoot: 64,
  Quartz: 65,
  Basalt: 66,
  GreenTerracotta: 67,
  StrippedSpruce: 68,
  BlackConcrete: 69,
  RoofSlab: 70,
  RoofTiles: 71,
  QuartzSlab: 72,
  WhiteConcrete: 73,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export type BlockState =
  | { kind: "byte"; name: string; value: number }
  | { kind: "int"; name: string; value: number }
  | { kind: "string"; name: string; value: string };

export type BlockDef = {
  name: string;
  states: BlockState[];
  color: [number, number, number];
  bright?: boolean;
  scale?: [number, number, number];
};

/** Block-state schema version written into every palette entry: 1.20.70.4. */
export const BLOCK_STATE_VERSION = (1 << 24) | (20 << 16) | (70 << 8) | 4;

const LABELS: Partial<Record<BlockId, string>> = {
  [Block.Grass]: "Grass",
  [Block.Snow]: "Snow",
  [Block.OakSign]: "Oak sign",
  [Block.CoarseDirt]: "Coarse dirt",
  [Block.PackedIce]: "Packed ice",
  [Block.BlueIce]: "Blue ice",
  [Block.SeaLantern]: "Sea lantern",
  [Block.MossyCobblestone]: "Mossy cobblestone",
  [Block.RedSand]: "Red sand",
  [Block.RedSandstone]: "Red sandstone",
  [Block.OrangeTerracotta]: "Orange terracotta",
  [Block.RedTerracotta]: "Red terracotta",
  [Block.YellowTerracotta]: "Yellow terracotta",
  [Block.WhiteTerracotta]: "White terracotta",
  [Block.BrownTerracotta]: "Brown terracotta",
  [Block.OakLog]: "Oak log",
  [Block.OakLeaves]: "Oak leaves",
  [Block.SpruceLog]: "Spruce log",
  [Block.SpruceLeaves]: "Spruce leaves",
  [Block.OakPlanks]: "Oak planks",
  [Block.SprucePlanks]: "Spruce planks",
  [Block.OakFence]: "Oak fence",
  [Block.SpruceFence]: "Spruce fence",
  [Block.WhiteWool]: "White wool",
  [Block.RedWool]: "Red wool",
  [Block.YellowWool]: "Yellow wool",
  [Block.LimeWool]: "Lime wool",
};

export function blockLabel(id: BlockId): string {
  const named = LABELS[id];
  if (named) return named;
  const raw = BLOCKS[id].name.replace(/^minecraft:/, "").replaceAll("_", " ");
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function blockSwatch(id: BlockId): string {
  const [red, green, blue] = BLOCKS[id].color;
  return `rgb(${red} ${green} ${blue})`;
}

const log = (axis = "y"): BlockState[] => [{ kind: "string", name: "pillar_axis", value: axis }];
const leaves: BlockState[] = [
  { kind: "byte", name: "persistent_bit", value: 1 },
  { kind: "byte", name: "update_bit", value: 0 },
];

const door = (direction: string, upper: number): BlockDef => ({
  name: "minecraft:oak_door",
  states: [
    { kind: "string", name: "minecraft:cardinal_direction", value: direction },
    { kind: "byte", name: "upper_block_bit", value: upper },
    { kind: "byte", name: "open_bit", value: 0 },
    { kind: "byte", name: "door_hinge_bit", value: 0 },
  ],
  color: [149, 108, 64],
  scale: direction === "east" ? [0.18, 1, 1] : [1, 1, 0.18],
});

const stair = (direction: number): BlockDef => ({
  name: "minecraft:oak_stairs",
  states: [
    { kind: "byte", name: "upside_down_bit", value: 0 },
    { kind: "int", name: "weirdo_direction", value: direction },
  ],
  color: [184, 144, 91],
});

const bed = (head: number): BlockDef => ({
  name: "minecraft:bed",
  states: [
    { kind: "int", name: "direction", value: 2 },
    { kind: "byte", name: "head_piece_bit", value: head },
    { kind: "byte", name: "occupied_bit", value: 0 },
  ],
  color: head ? [234, 228, 211] : [158, 62, 48],
  scale: [1, 0.56, 1],
});

export const BLOCKS: Record<BlockId, BlockDef> = {
  [Block.Air]: { name: "minecraft:air", states: [], color: [0, 0, 0] },
  [Block.Bedrock]: { name: "minecraft:bedrock", states: [], color: [48, 48, 48] },
  [Block.Stone]: { name: "minecraft:stone", states: [], color: [126, 126, 126] },
  [Block.Dirt]: { name: "minecraft:dirt", states: [], color: [134, 96, 67] },
  [Block.Grass]: { name: "minecraft:grass_block", states: [], color: [92, 158, 68] },
  [Block.Sand]: { name: "minecraft:sand", states: [], color: [219, 207, 160] },
  [Block.Gravel]: { name: "minecraft:gravel", states: [], color: [136, 126, 122] },
  [Block.Water]: {
    name: "minecraft:water",
    states: [{ kind: "int", name: "liquid_depth", value: 0 }],
    color: [56, 132, 176],
  },
  [Block.OakLog]: { name: "minecraft:oak_log", states: log(), color: [102, 81, 51] },
  [Block.OakLeaves]: { name: "minecraft:oak_leaves", states: leaves, color: [72, 140, 58] },
  [Block.SpruceLog]: { name: "minecraft:spruce_log", states: log(), color: [78, 60, 38] },
  [Block.SpruceLeaves]: { name: "minecraft:spruce_leaves", states: leaves, color: [64, 122, 78] },
  [Block.OakPlanks]: { name: "minecraft:oak_planks", states: [], color: [186, 150, 98] },
  [Block.SprucePlanks]: { name: "minecraft:spruce_planks", states: [], color: [114, 84, 48] },
  [Block.Cobblestone]: { name: "minecraft:cobblestone", states: [], color: [128, 128, 128] },
  [Block.MossyCobblestone]: { name: "minecraft:mossy_cobblestone", states: [], color: [96, 118, 86] },
  [Block.Glass]: { name: "minecraft:glass", states: [], color: [198, 224, 230] },
  [Block.Sandstone]: { name: "minecraft:sandstone", states: [], color: [216, 202, 156] },
  [Block.RedSand]: { name: "minecraft:red_sand", states: [], color: [190, 102, 58] },
  [Block.RedSandstone]: { name: "minecraft:red_sandstone", states: [], color: [180, 96, 52] },
  [Block.OrangeTerracotta]: { name: "minecraft:orange_terracotta", states: [], color: [162, 84, 38] },
  [Block.RedTerracotta]: { name: "minecraft:red_terracotta", states: [], color: [143, 60, 46] },
  [Block.YellowTerracotta]: { name: "minecraft:yellow_terracotta", states: [], color: [186, 133, 56] },
  [Block.WhiteTerracotta]: { name: "minecraft:white_terracotta", states: [], color: [210, 178, 162] },
  [Block.BrownTerracotta]: { name: "minecraft:brown_terracotta", states: [], color: [120, 72, 50] },
  [Block.Snow]: { name: "minecraft:snow_block", states: [], color: [236, 242, 246] },
  [Block.PackedIce]: { name: "minecraft:packed_ice", states: [], color: [164, 196, 220] },
  [Block.BlueIce]: { name: "minecraft:blue_ice", states: [], color: [116, 168, 208] },
  [Block.CoarseDirt]: { name: "minecraft:coarse_dirt", states: [], color: [120, 86, 58] },
  [Block.Podzol]: { name: "minecraft:podzol", states: [], color: [92, 70, 40] },
  [Block.Moss]: { name: "minecraft:moss_block", states: [], color: [82, 140, 64] },
  [Block.Glowstone]: { name: "minecraft:glowstone", states: [], color: [244, 214, 120], bright: true },
  [Block.SeaLantern]: { name: "minecraft:sea_lantern", states: [], color: [176, 220, 214], bright: true },
  [Block.Hay]: { name: "minecraft:hay_block", states: log(), color: [196, 168, 52] },
  [Block.Pumpkin]: { name: "minecraft:pumpkin", states: [], color: [214, 128, 32] },
  [Block.OakFence]: {
    name: "minecraft:oak_fence",
    states: [],
    color: [186, 150, 98],
    scale: [0.28, 1, 0.28],
  },
  [Block.SpruceFence]: {
    name: "minecraft:spruce_fence",
    states: [],
    color: [114, 84, 48],
    scale: [0.28, 1, 0.28],
  },
  [Block.Lantern]: {
    name: "minecraft:lantern",
    states: [{ kind: "byte", name: "hanging", value: 0 }],
    color: [232, 164, 64],
    bright: true,
    scale: [0.38, 0.5, 0.38],
  },
  [Block.Campfire]: {
    name: "minecraft:campfire",
    states: [
      { kind: "byte", name: "extinguished", value: 0 },
      { kind: "string", name: "minecraft:cardinal_direction", value: "south" },
    ],
    color: [214, 108, 42],
    bright: true,
    scale: [0.86, 0.45, 0.86],
  },
  [Block.Cactus]: {
    name: "minecraft:cactus",
    states: [{ kind: "int", name: "age", value: 0 }],
    color: [62, 140, 58],
    scale: [0.72, 1, 0.72],
  },
  [Block.OakSign]: {
    name: "minecraft:oak_standing_sign",
    states: [{ kind: "int", name: "ground_sign_direction", value: 8 }],
    color: [176, 140, 88],
    scale: [0.7, 0.72, 0.12],
  },
  [Block.WhiteWool]: { name: "minecraft:white_wool", states: [], color: [234, 236, 236] },
  [Block.RedWool]: { name: "minecraft:red_wool", states: [], color: [176, 48, 46] },
  [Block.YellowWool]: { name: "minecraft:yellow_wool", states: [], color: [240, 196, 48] },
  [Block.LimeWool]: { name: "minecraft:lime_wool", states: [], color: [112, 186, 48] },
  [Block.Clay]: { name: "minecraft:clay", states: [], color: [160, 166, 176] },
  [Block.LightGrayConcrete]: { name: "minecraft:light_gray_concrete", states: [], color: [125, 125, 115] },
  [Block.GrayConcrete]: { name: "minecraft:gray_concrete", states: [], color: [54, 57, 61] },
  [Block.YellowConcrete]: { name: "minecraft:yellow_concrete", states: [], color: [241, 175, 21] },
  [Block.Brick]: { name: "minecraft:brick_block", states: [], color: [150, 97, 83] },
  [Block.StoneBricks]: { name: "minecraft:stone_bricks", states: [], color: [122, 121, 122] },
  [Block.Chest]: {
    name: "minecraft:chest",
    states: [{ kind: "string", name: "minecraft:cardinal_direction", value: "south" }],
    color: [176, 140, 88],
  },
  [Block.Furnace]: {
    name: "minecraft:furnace",
    states: [{ kind: "string", name: "minecraft:cardinal_direction", value: "north" }],
    color: [120, 120, 120],
  },
  [Block.CraftingTable]: { name: "minecraft:crafting_table", states: [], color: [150, 100, 58] },
  [Block.Bookshelf]: { name: "minecraft:bookshelf", states: [], color: [140, 110, 70] },
  [Block.OakDoorLower]: door("south", 0),
  [Block.OakDoorUpper]: door("south", 1),
  [Block.OakDoorEastLower]: door("east", 0),
  [Block.OakDoorEastUpper]: door("east", 1),
  [Block.OakStairWest]: stair(1),
  [Block.OakStairNorth]: stair(3),
  [Block.OakStairSouth]: stair(2),
  [Block.BedHead]: bed(1),
  [Block.BedFoot]: bed(0),
  [Block.Quartz]: { name: "minecraft:quartz_block", states: [{ kind: "string", name: "chisel_type", value: "default" }, ...log()], color: [237, 233, 219] },
  [Block.Basalt]: { name: "minecraft:basalt", states: log(), color: [75, 73, 78] },
  [Block.GreenTerracotta]: { name: "minecraft:green_terracotta", states: [], color: [87, 99, 59] },
  [Block.StrippedSpruce]: { name: "minecraft:stripped_spruce_log", states: log("x"), color: [161, 113, 61] },
  [Block.BlackConcrete]: { name: "minecraft:black_concrete", states: [], color: [33, 37, 42] },
  [Block.RoofSlab]: { name: "minecraft:deepslate_tile_slab", states: [{ kind: "byte", name: "top_slot_bit", value: 0 }], color: [58, 61, 65], scale: [1, 0.5, 1] },
  [Block.RoofTiles]: { name: "minecraft:deepslate_tiles", states: [], color: [58, 61, 65] },
  [Block.QuartzSlab]: { name: "minecraft:stone_block_slab", states: [{ kind: "string", name: "stone_slab_type", value: "quartz" }, { kind: "byte", name: "top_slot_bit", value: 0 }], color: [222, 219, 207], scale: [1, 0.5, 1] },
  [Block.WhiteConcrete]: { name: "minecraft:white_concrete", states: [], color: [207, 213, 214] },
  [Block.Ladder]: {
    name: "minecraft:ladder",
    states: [{ kind: "string", name: "minecraft:cardinal_direction", value: "south" }],
    color: [140, 110, 60],
  },
};
