import type { BlockId } from "@/lib/blocks";

export const COMMERCIAL_TYPES = {
  any: "Coeur d’Alene mix",
  sherman_storefront: "Sherman Ave storefront",
  strip_plaza: "Strip plaza / retail",
  cafe_diner: "Coffeehouse / diner",
  office_midrise: "Riverstone office",
  warehouse: "Industrial warehouse",
  auto_shop: "Auto / marine service",
  lakefront_lodge: "Lakefront hotel / brewery",
} as const;

export const COMMERCIAL_ERAS = {
  any: "Any era",
  historic: "Historic · Pre-1960",
  midcentury: "1960–1999",
  contemporary: "2000 onward",
} as const;

export const COMMERCIAL_SCALES = {
  any: "Any scale",
  small: "Small / single-tenant",
  medium: "Medium / multi-bay",
  large: "Large / anchor",
} as const;

export const COMMERCIAL_STORE_TYPES = {
  any: "Any store type",
  grocery: "Grocery store",
  clothing: "Clothing store",
  hardware: "Hardware & outdoor",
  pharmacy: "Pharmacy & apothecary",
} as const;

export type CommercialType = keyof typeof COMMERCIAL_TYPES;
export type CommercialEra = keyof typeof COMMERCIAL_ERAS;
export type CommercialScale = keyof typeof COMMERCIAL_SCALES;
export type CommercialStoreType = keyof typeof COMMERCIAL_STORE_TYPES;

export type CommercialMaterialOverrides = {
  wall?: BlockId;
  accent?: BlockId;
  trim?: BlockId;
  roof?: BlockId;
};

export type CommercialRequest = {
  type?: CommercialType;
  era?: CommercialEra;
  scale?: CommercialScale;
  storeType?: CommercialStoreType;
  seed?: number;
  materials?: CommercialMaterialOverrides;
};

export const TYPE_SCALES = {
  sherman_storefront: ["small", "medium", "large"],
  strip_plaza: ["medium", "large"],
  cafe_diner: ["small", "medium"],
  office_midrise: ["medium", "large"],
  warehouse: ["small", "medium", "large"],
  auto_shop: ["small", "medium"],
  lakefront_lodge: ["medium", "large"],
} satisfies Record<Exclude<CommercialType, "any">, Exclude<CommercialScale, "any">[]>;

export function supportsScale(type: CommercialType, scale: CommercialScale) {
  return type === "any" || scale === "any" || TYPE_SCALES[type].some((option) => option === scale);
}
