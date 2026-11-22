export const UFO_CIVILIZATIONS = {
  classic: "Classic",
  xenos: "Xenos",
  blight: "The Blight",
} as const;

const CIVILIZATION_HULLS = {
  classic: { saucer: "Classic saucer", scout: "Long-range scout", carrier: "Ring carrier" },
  xenos: { shrike: "Shrike", broodArk: "Brood ark", maw: "Maw frigate" },
  blight: { seedstone: "Seedstone", splitGeode: "Split geode", hiveCluster: "Hive cluster" },
} as const;

export const UFO_HULLS = { ...CIVILIZATION_HULLS.classic, ...CIVILIZATION_HULLS.xenos, ...CIVILIZATION_HULLS.blight };

export const UFO_CONDITIONS = {
  landed: "Landed",
  impact: "Nose-down impact",
  skid: "Skidded wreck",
  exploded: "Exploded wreck",
} as const;

export type UfoCivilization = keyof typeof UFO_CIVILIZATIONS;
export type UfoHull = keyof typeof UFO_HULLS;
export type XenosHull = keyof typeof CIVILIZATION_HULLS.xenos;
export type ClassicHull = keyof typeof CIVILIZATION_HULLS.classic;
export type AsteroidHull = keyof typeof CIVILIZATION_HULLS.blight;
export type UfoCondition = keyof typeof UFO_CONDITIONS;
export type UfoRequest = {
  civilization?: UfoCivilization;
  hull?: UfoHull | "any";
  condition?: UfoCondition | "any";
  seed?: number;
};

export function hullsFor(civilization: UfoCivilization): UfoHull[] {
  return Object.keys(CIVILIZATION_HULLS[civilization]) as UfoHull[];
}

export function civilizationFor(hull: UfoHull): UfoCivilization {
  return (Object.keys(CIVILIZATION_HULLS) as UfoCivilization[])
    .find((civilization) => Object.hasOwn(CIVILIZATION_HULLS[civilization], hull))!;
}

export function conditionLabel(civilization: UfoCivilization, condition: UfoCondition) {
  return civilization === "blight" ? {
    landed: "Intact fall",
    impact: "Buried impact",
    skid: "Skidded fragment",
    exploded: "Shattered core",
  }[condition] : UFO_CONDITIONS[condition];
}
