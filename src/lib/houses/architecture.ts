import type { HouseStyle } from './catalog';

/** Limits apply to the whole silhouette, including a porch canopy. */
export const ARCHITECTURE: Record<Exclude<HouseStyle, 'any'>, {
  maxRooflines: number;
  maxBodies: number;
  porchCanopy: boolean;
}> = {
  manufactured: { maxRooflines: 1, maxBodies: 1, porchCanopy: false },
  ranch: { maxRooflines: 2, maxBodies: 2, porchCanopy: false },
  suburban: { maxRooflines: 3, maxBodies: 3, porchCanopy: true },
  craftsman: { maxRooflines: 3, maxBodies: 2, porchCanopy: true },
  farmhouse: { maxRooflines: 3, maxBodies: 2, porchCanopy: true },
  pnw_lodge: { maxRooflines: 4, maxBodies: 3, porchCanopy: true },
  pnw_modern: { maxRooflines: 4, maxBodies: 3, porchCanopy: true },
};
