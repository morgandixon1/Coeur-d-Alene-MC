import type { BlockId } from "@/lib/blocks";

export const HOUSE_STYLES = {
  any: "Coeur d’Alene mix",
  manufactured: "Manufactured / trailer",
  ranch: "Everyday ranch",
  suburban: "Garage-front suburban",
  craftsman: "Inland Northwest craftsman",
  farmhouse: "Modern farmhouse",
  pnw_lodge: "North Idaho timber lodge",
  pnw_modern: "PNW lake modern",
} as const;

export const HOUSE_ERAS = {
  any: "Any era · 1990 onward",
  suburban90s: "1990–2009",
  contemporary: "2010 onward",
} as const;

export const HOUSE_PRICES = {
  any: "Any tier",
  starter: "Starter",
  mid: "Midrange",
  upscale: "Upscale",
  luxury: "Luxury",
} as const;

export type HouseStyle = keyof typeof HOUSE_STYLES;
export type HouseEra = keyof typeof HOUSE_ERAS;
export type HousePrice = keyof typeof HOUSE_PRICES;
export type HouseMaterialOverrides = {
  wall?: BlockId;
  accent?: BlockId;
  trim?: BlockId;
  roof?: BlockId;
};
export type HouseRequest = {
  style?: HouseStyle;
  era?: HouseEra;
  price?: HousePrice;
  seed?: number;
  materials?: HouseMaterialOverrides;
  overture?: boolean;
};

export const STYLE_TIERS = {
  manufactured: ["starter", "mid"],
  ranch: ["starter", "mid", "upscale"],
  suburban: ["starter", "mid", "upscale"],
  craftsman: ["mid", "upscale", "luxury"],
  farmhouse: ["mid", "upscale", "luxury"],
  pnw_lodge: ["mid", "upscale", "luxury"],
  pnw_modern: ["upscale", "luxury"],
} satisfies Record<Exclude<HouseStyle, "any">, Exclude<HousePrice, "any">[]>;

export function supportsTier(style: HouseStyle, tier: HousePrice) {
  return style === "any" || tier === "any" || STYLE_TIERS[style].some((option) => option === tier);
}
