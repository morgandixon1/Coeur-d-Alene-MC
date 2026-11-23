import type { BlockId } from "@/lib/blocks";
import type { HouseEra, HousePrice, HouseStyle } from "./catalog";
import type { HouseBed, HouseChest } from "./generate";
import {
  cellsToClearanceRects,
  projectBuildingFeature,
  type MeasuredEnvelope,
  type OvertureBuildingFeature,
  type Rect2D,
} from "./footprint";
import { buildFootprintHouse, type HeightAssumption } from "./footprint-build";

export type SkipReason =
  | "underground"
  | "empty_footprint"
  | "out_of_bounds"
  | "road"
  | "water"
  | "poi"
  | "building_overlap"
  | "no_terrain";

export type PlacedBuilding = {
  id: string;
  status: "placed";
  seed: number;
  foundationY: number;
  envelope: MeasuredEnvelope;
  frontBearingDeg: number | null;
  heightAssumption: HeightAssumption;
  stories: number;
  style: Exclude<HouseStyle, "any">;
  blocks: { x: number; y: number; z: number; block: BlockId }[];
  chests: HouseChest[];
  beds: HouseBed[];
  clearances: Rect2D[];
  doorCell: { x: number; y: number; z: number } | null;
};

export type SkippedBuilding = {
  id: string;
  status: "skipped";
  reason: SkipReason;
  envelope: MeasuredEnvelope;
};

export type BuildingPlacementRecord = PlacedBuilding | SkippedBuilding;

export type PlacementContext = {
  bounds?: Rect2D;
  groundY: (x: number, z: number) => number | null;
  isRoad?: (x: number, z: number) => boolean;
  isWater?: (x: number, z: number) => boolean;
  isPoi?: (x: number, z: number) => boolean;
  nearestRoadPoint?: (x: number, z: number) => { x: number; z: number } | null;
  allowUnderground?: boolean;
  style?: Exclude<HouseStyle, "any">;
  price?: Exclude<HousePrice, "any">;
  era?: Exclude<HouseEra, "any">;
  /** Optional pre-reserved columns (e.g. hand-authored structures) before placing buildings. */
  reservedColumns?: Iterable<readonly [number, number]>;
};

export type PlacementBatchResult = {
  records: BuildingPlacementRecord[];
  placed: PlacedBuilding[];
  skipped: SkippedBuilding[];
  /** Merged half-open integer clearance rectangles covering all placed building columns. */
  clearances: Rect2D[];
};

export function pointInRect(x: number, z: number, rect: Rect2D): boolean {
  return x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1;
}

export function pointInRects(x: number, z: number, rects: readonly Rect2D[]): boolean {
  return rects.some((rect) => pointInRect(x, z, rect));
}

/**
 * Project, conflict-check, fit, and place a batch of Overture building features.
 * Deterministic ordering ensures stable winner selection when two footprints overlap.
 */
export function placeOvertureBuildings(
  features: readonly OvertureBuildingFeature[],
  context: PlacementContext,
): PlacementBatchResult {
  const occupied = new Set<string>();
  const allOccupiedCells: [number, number][] = [];
  if (context.reservedColumns) {
    for (const [x, z] of context.reservedColumns) {
      occupied.add(`${x},${z}`);
    }
  }

  const seenIds = new Set<string>();
  const records: BuildingPlacementRecord[] = [];
  const placed: PlacedBuilding[] = [];
  const skipped: SkippedBuilding[] = [];

  for (const feature of features) {
    if (seenIds.has(feature.id)) continue;
    seenIds.add(feature.id);

    const footprint = projectBuildingFeature(feature);

    if (footprint.properties.is_underground === true && !context.allowUnderground) {
      const rec: SkippedBuilding = { id: feature.id, status: "skipped", reason: "underground", envelope: footprint.envelope };
      records.push(rec);
      skipped.push(rec);
      continue;
    }

    if (footprint.cells.length === 0) {
      const rec: SkippedBuilding = { id: feature.id, status: "skipped", reason: "empty_footprint", envelope: footprint.envelope };
      records.push(rec);
      skipped.push(rec);
      continue;
    }

    if (context.bounds) {
      const b = context.bounds;
      const inBounds = footprint.cells.every(([x, z]) => pointInRect(x, z, b));
      if (!inBounds) {
        const rec: SkippedBuilding = { id: feature.id, status: "skipped", reason: "out_of_bounds", envelope: footprint.envelope };
        records.push(rec);
        skipped.push(rec);
        continue;
      }
    }

    // Check reserved masks in explicit priority order: road, water, poi, building_overlap, no_terrain.
    let conflict: SkipReason | null = null;
    for (const [x, z] of footprint.cells) {
      if (context.isRoad?.(x, z)) {
        conflict = "road";
        break;
      }
      if (context.isWater?.(x, z)) {
        conflict = "water";
        break;
      }
      if (context.isPoi?.(x, z)) {
        conflict = "poi";
        break;
      }
      if (occupied.has(`${x},${z}`)) {
        conflict = "building_overlap";
        break;
      }
      if (context.groundY(x, z) === null) {
        conflict = "no_terrain";
        break;
      }
    }

    if (conflict) {
      const rec: SkippedBuilding = { id: feature.id, status: "skipped", reason: conflict, envelope: footprint.envelope };
      records.push(rec);
      skipped.push(rec);
      continue;
    }

    const nearestRoad = context.nearestRoadPoint?.(footprint.envelope.centerX, footprint.envelope.centerZ) ?? null;
    const built = buildFootprintHouse(footprint, {
      groundY: context.groundY,
      style: context.style,
      price: context.price,
      era: context.era,
      nearestRoadPoint: nearestRoad,
      isBlockedExterior: (x, z) => Boolean(context.isWater?.(x, z) || context.isPoi?.(x, z) || occupied.has(`${x},${z}`)),
    });

    // Collect every emitted column (walls, roofs, interior) for clearance and overlap protection.
    const buildingCols = new Map<string, [number, number]>();
    for (const block of built.blocks) {
      buildingCols.set(`${block.x},${block.z}`, [block.x, block.z]);
    }
    for (const [x, z] of footprint.cells) {
      buildingCols.set(`${x},${z}`, [x, z]);
    }

    for (const [k, col] of buildingCols) {
      occupied.add(k);
      allOccupiedCells.push(col);
    }

    const clearances = cellsToClearanceRects(buildingCols.values());
    const rec: PlacedBuilding = {
      id: built.id,
      status: "placed",
      seed: built.seed,
      foundationY: built.foundationY,
      envelope: footprint.envelope,
      frontBearingDeg: built.frontBearingDeg,
      heightAssumption: built.heightAssumption,
      stories: built.stories,
      style: built.style,
      blocks: built.blocks,
      chests: built.chests,
      beds: built.beds,
      clearances,
      doorCell: built.doorCell,
    };
    records.push(rec);
    placed.push(rec);
  }

  return {
    records,
    placed,
    skipped,
    clearances: cellsToClearanceRects(allOccupiedCells),
  };
}

/**
 * Simple foliage clearance check helper (adds the 2 m buffer used by the local foliage planner)
 * so callers and tests can verify no plant voxel enters a reserved building clearance.
 */
export function isClearedForFoliage(x: number, z: number, clearances: readonly Rect2D[], bufferM = 2): boolean {
  for (const rect of clearances) {
    if (x >= rect.x0 - bufferM && x < rect.x1 + bufferM && z >= rect.z0 - bufferM && z < rect.z1 + bufferM) {
      return false;
    }
  }
  return true;
}
