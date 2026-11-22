export const THEME_IDS = ["pine-camp", "cove", "mesa", "snowfield", "festival"] as const;
export const SIZE_IDS = ["intimate", "weekend", "expedition"] as const;
export const GAME_MODES = ["survival", "creative", "adventure"] as const;
export const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type SizeId = (typeof SIZE_IDS)[number];
export type GameMode = (typeof GAME_MODES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];

export type WorldSettings = {
  name: string;
  seed: number;
  theme: ThemeId;
  gameMode: GameMode;
  difficulty: Difficulty;
  size: SizeId;
  cheats: boolean;
  timeOfDay: number;
  freezeTime: boolean;
};

export const SIZE_BLOCKS: Record<SizeId, number> = {
  intimate: 64,
  weekend: 96,
  expedition: 128,
};

export const THEMES: { id: ThemeId; name: string; blurb: string; swatch: string }[] = [
  {
    id: "pine-camp",
    name: "Pine camp",
    blurb: "Spruce, a cabin, and a fire ring around the meeting stone.",
    swatch: "#2f6b45",
  },
  {
    id: "cove",
    name: "Cove",
    blurb: "A sand lagoon, a plank dock, and a dune hut.",
    swatch: "#3d8ea6",
  },
  {
    id: "mesa",
    name: "Mesa",
    blurb: "Terracotta shelves, a sandstone lookout, and cactus.",
    swatch: "#d06a3a",
  },
  {
    id: "snowfield",
    name: "Snowfield",
    blurb: "Snow, a frozen pond, and a spruce cabin.",
    swatch: "#8fb4c9",
  },
  {
    id: "festival",
    name: "Festival green",
    blurb: "Wool paths into a lantern stage for the group.",
    swatch: "#e2b23a",
  },
];

export const SIZES: { id: SizeId; name: string; detail: string }[] = [
  { id: "intimate", name: "Intimate", detail: "64 × 64" },
  { id: "weekend", name: "Weekend", detail: "96 × 96" },
  { id: "expedition", name: "Expedition", detail: "128 × 128" },
];

export const MODES: { id: GameMode; name: string }[] = [
  { id: "survival", name: "Survival" },
  { id: "creative", name: "Creative" },
  { id: "adventure", name: "Adventure" },
];

export const DIFFICULTY_OPTIONS: { id: Difficulty; name: string }[] = [
  { id: "peaceful", name: "Peaceful" },
  { id: "easy", name: "Easy" },
  { id: "normal", name: "Normal" },
  { id: "hard", name: "Hard" },
];

export const DEFAULT_SETTINGS: WorldSettings = {
  name: "Campfire Meet",
  seed: 184720,
  theme: "pine-camp",
  gameMode: "survival",
  difficulty: "easy",
  size: "weekend",
  cheats: false,
  timeOfDay: 6000,
  freezeTime: false,
};

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

export function parseSettings(input: unknown): WorldSettings {
  if (input === null || typeof input !== "object") {
    throw new SettingsError("Missing world settings.");
  }
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.replace(/[\u0000-\u001f]/g, "").trim() : "";
  if (name.length < 1 || name.length > 40) {
    throw new SettingsError("Name the world with 1–40 characters.");
  }
  if (!isOneOf(raw.theme, THEME_IDS)) throw new SettingsError("Choose a world type.");
  if (!isOneOf(raw.gameMode, GAME_MODES)) throw new SettingsError("Choose a game mode.");
  if (!isOneOf(raw.difficulty, DIFFICULTIES)) throw new SettingsError("Choose a difficulty.");
  if (!isOneOf(raw.size, SIZE_IDS)) throw new SettingsError("Choose a world size.");
  const seed = typeof raw.seed === "number" ? raw.seed : Number(raw.seed);
  if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) {
    throw new SettingsError("Seed must be a whole number.");
  }
  const timeOfDay = typeof raw.timeOfDay === "number" ? raw.timeOfDay : Number(raw.timeOfDay);
  if (!Number.isInteger(timeOfDay) || timeOfDay < 0 || timeOfDay > 24000) {
    throw new SettingsError("Time of day is out of range.");
  }
  return {
    name,
    seed,
    theme: raw.theme,
    gameMode: raw.gameMode,
    difficulty: raw.difficulty,
    size: raw.size,
    cheats: raw.cheats === true,
    timeOfDay,
    freezeTime: raw.freezeTime === true,
  };
}

export function timeLabel(tick: number): string {
  if (tick < 800 || tick >= 23000) return "Dawn";
  if (tick < 4500) return "Morning";
  if (tick < 8000) return "Noon";
  if (tick < 11500) return "Afternoon";
  if (tick < 14000) return "Sunset";
  if (tick < 22000) return "Night";
  return "Sunrise";
}

export function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "world"}.mcworld`;
}
