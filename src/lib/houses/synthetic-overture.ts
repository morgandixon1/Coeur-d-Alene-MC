import { blockToUtm, fromUtm } from "@/lib/inw/grid";
import { HOUSE_ERAS, HOUSE_PRICES, STYLE_TIERS, supportsTier, type HouseRequest, type HouseStyle } from "./catalog";
import { projectBuildingFeature, type OvertureBuildingFeature } from "./footprint";
import { buildFootprintHouse } from "./footprint-build";
import { rng, type House } from "./generate";

type Style = Exclude<HouseStyle, "any">;
type Price = Exclude<NonNullable<HouseRequest["price"]>, "any">;
type Era = Exclude<NonNullable<HouseRequest["era"]>, "any">;

const STYLE_NAMES: Record<Style, string> = {
  manufactured: "Manufactured home",
  ranch: "North Idaho ranch",
  suburban: "Garage-front suburban",
  craftsman: "Inland Northwest craftsman",
  farmhouse: "North Idaho modern farmhouse",
  pnw_lodge: "North Idaho timber lodge",
  pnw_modern: "PNW lake modern",
};

const MIX: readonly Style[] = [
  "manufactured", "manufactured",
  "ranch", "ranch", "ranch",
  "suburban", "suburban", "suburban",
  "craftsman", "farmhouse", "pnw_lodge", "pnw_modern",
];

type ShapeArchetype = {
  label: string;
  polygons: [number, number][][][];
  floors?: number;
  height?: number;
};

function rect(length: number, width: number, cx = 0, cz = 0): [number, number][] {
  return [
    [cx - length / 2, cz - width / 2],
    [cx + length / 2, cz - width / 2],
    [cx + length / 2, cz + width / 2],
    [cx - length / 2, cz + width / 2],
  ];
}

function rotateRingToGeo(ring: [number, number][], bearingDeg: number): [number, number][] {
  const a = (bearingDeg * Math.PI) / 180;
  const world = ring.map(([u, v]): [number, number] => [
    u * Math.sin(a) + v * Math.cos(a),
    -u * Math.cos(a) + v * Math.sin(a),
  ]);
  world.push(world[0]!);
  return world.map(([x, z]) => {
    const { e, n } = blockToUtm(x, z);
    const { lon, lat } = fromUtm(e, n);
    return [Number(lon.toFixed(9)), Number(lat.toFixed(9))];
  });
}

function pickArchetype(style: Style, price: Price, random: () => number): ShapeArchetype {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  if (style === "manufactured") {
    const doubleWide = price === "mid" || random() < 0.45;
    const len = doubleWide ? int(16, 20) : int(16, 22);
    const wid = doubleWide ? int(9, 11) : int(6, 7);
    return {
      label: doubleWide ? "Overture double-wide" : "Overture single-wide",
      polygons: [[rect(len, wid)]],
      floors: 1,
    };
  }

  const candidates: ShapeArchetype[] = [
    // Rotated rectangle (e.g. along E Lilly Dr)
    {
      label: "Overture rectangle",
      polygons: [[rect(int(16, 21), int(10, 13))]],
    },
    // L-shaped home with garage/bedroom wing (like E Lilly Dr & rotated-l fixture)
    (() => {
      const l = int(18, 22);
      const w = int(13, 16);
      const hl = l / 2;
      const hw = w / 2;
      const wingX = Math.round(l * 0.12);
      const wingZ = -Math.round(w * 0.08);
      return {
        label: "Overture L-wing",
        polygons: [[[[ -hl, -hw ], [ hl, -hw ], [ hl, wingZ ], [ wingX, wingZ ], [ wingX, hw ], [ -hl, hw ]]]],
      };
    })(),
    // T-shaped / cross-wing home (like E Lilly Dr & E Candy Ln corner lot)
    (() => {
      const l = int(18, 22);
      const w = int(9, 11);
      const hl = l / 2;
      const hw = w / 2;
      const bumpW = int(6, 8) / 2;
      const bumpD = int(3, 4);
      return {
        label: "Overture T-wing",
        polygons: [[[[ -hl, -hw ], [ -bumpW, -hw ], [ -bumpW, -hw - bumpD ], [ bumpW, -hw - bumpD ], [ bumpW, -hw ], [ hl, -hw ], [ hl, hw ], [ -hl, hw ]]]],
      };
    })(),
    // Offset bump-out (front/rear bay like E Lilly Dr houses)
    (() => {
      const l = int(16, 20);
      const w = int(10, 12);
      const hl = l / 2;
      const hw = w / 2;
      const bayL = int(6, 8);
      const bayD = int(3, 4);
      return {
        label: "Overture bump-out",
        polygons: [[[[ -hl, -hw ], [ hl, -hw ], [ hl, hw ], [ hl - bayL, hw ], [ hl - bayL, hw + bayD ], [ -hl + 2, hw + bayD ], [ -hl + 2, hw ], [ -hl, hw ]]]],
      };
    })(),
    // Main house + detached garage/shop (MultiPolygon like E Candy Ln & multipart fixture)
    (() => {
      const mainL = int(12, 15);
      const mainW = int(9, 11);
      const garL = int(6, 8);
      const garW = int(6, 8);
      return {
        label: "Overture house + detached garage",
        polygons: [
          [rect(mainL, mainW, -5, 0)],
          [rect(garL, garW, mainL / 2 + 1, 0)],
        ],
      };
    })(),
  ];

  // Add 2-story square & courtyard archetypes for upscale/luxury or multi-story styles.
  if (style !== "ranch") {
    candidates.push({
      label: "Overture compact 2-story",
      polygons: [[rect(int(12, 14), int(12, 14))]],
      floors: 2,
    });
  }
  if (price === "upscale" || price === "luxury") {
    candidates.push({
      label: "Overture courtyard",
      polygons: [[rect(22, 16), rect(8, 6)]],
      height: style === "pnw_modern" || style === "pnw_lodge" ? 10 : 8,
    });
  }

  return candidates[Math.floor(random() * candidates.length)]!;
}

/**
 * Generate a House Studio preview fitted to a synthetic Overture building footprint
 * with varied neighborhood shapes (L-wing, T-wing, bump-out, detached garage, courtyard)
 * and Coeur d'Alene street rotation bearings.
 */
export function generateOvertureHouse(options: HouseRequest = {}): House {
  const seed = (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const request: HouseRequest & { seed: number } = { ...options, seed, overture: true };
  const random = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;

  const requestedStyle = options.style ?? "any";
  const requestedPrice = options.price ?? "any";
  if (!supportsTier(requestedStyle, requestedPrice)) {
    throw new RangeError("That home style is unavailable at the selected tier.");
  }
  const style: Style = requestedStyle === "any" ? pick(MIX.filter((v) => supportsTier(v, requestedPrice))) : requestedStyle;
  const price: Price = requestedPrice === "any" ? pick(STYLE_TIERS[style]) : requestedPrice;
  const era: Era = !options.era || options.era === "any" ? pick(["suburban90s", "contemporary"] as const) : options.era;

  const shapeRandom = rng(seed ^ 0x9e3779b9);
  const archetype = pickArchetype(style, price, shapeRandom);
  // Realistic street-grid & angled Coeur d'Alene lot bearings (0°, 15°, 22°, 32°, 45°, 68°, 90°, 112°, 122°, 148°, 165°).
  const bearings = [0, 15, 22, 32, 45, 68, 90, 112, 122, 148, 165];
  const bearingDeg = bearings[Math.floor(shapeRandom() * bearings.length)]!;

  const geoPolygons = archetype.polygons.map((poly) =>
    poly.map((ring, ringIdx) => rotateRingToGeo(ringIdx === 0 ? [...ring].reverse() : ring, bearingDeg)),
  );
  const feature: OvertureBuildingFeature = {
    type: "Feature",
    id: `synthetic-overture-${seed}`,
    properties: {
      subtype: "residential",
      ...(archetype.height ? { height: archetype.height } : {}),
      ...(archetype.floors ? { num_floors: archetype.floors } : {}),
    },
    geometry:
      geoPolygons.length === 1
        ? { type: "Polygon", coordinates: geoPolygons[0]! }
        : { type: "MultiPolygon", coordinates: geoPolygons },
  };

  const projected = projectBuildingFeature(feature, seed);
  const built = buildFootprintHouse(projected, {
    groundY: () => 0,
    style,
    price,
    era,
    materials: options.materials,
  });

  const { bounds, envelope } = projected;
  const displayBearing = envelope.axisBearingDeg === null ? bearingDeg : Math.round(envelope.axisBearingDeg);
  const floors = Array.from({ length: built.stories }, (_, i) => ({
    floorY: i * built.storyHeight,
    cutY: (i + 1) * built.storyHeight,
    rooms:
      i === 0
        ? built.stories === 1
          ? ["Great room", "Kitchen / dining", "Bedroom"]
          : style === "pnw_lodge"
            ? ["Great room & hearth", "Kitchen / dining", "Study"]
            : style === "pnw_modern"
              ? ["Lakefront great room", "Chef's kitchen", "Linear hearth lounge"]
              : ["Living room", "Kitchen / dining", "Study"]
        : style === "pnw_modern"
          ? ["Primary lake suite", "Guest suite", "Sky loft"]
          : ["Primary bedroom", "Guest bedroom", "Loft"],
  }));

  const envW = Math.max(1, bounds.x1 - bounds.x0);
  const envD = Math.max(1, bounds.z1 - bounds.z0);
  const syntheticPlan: House["plan"] = {
    family: `${archetype.label} · ${displayBearing}°`,
    volumes: [{ id: 0, x: bounds.x0, z: bounds.z0, w: envW, d: envD, use: "Living room", stories: built.stories }],
    envelopes: [{ x: bounds.x0, z: bounds.z0, w: envW, d: envD, stories: built.stories, rooms: [0] }],
    connections: [],
    entry: built.doorCell ? { x: built.doorCell.x, z: built.doorCell.z } : { x: 0, z: 0 },
    signature: `overture:${archetype.label}:${displayBearing}:${projected.cells.length}`,
    roofs: [],
    porchCanopy: false,
  };

  return {
    plan: syntheticPlan,
    seed,
    request,
    style,
    era,
    price,
    title: `${STYLE_NAMES[style]} · ${archetype.label} (${displayBearing}°)`,
    badge: `${HOUSE_ERAS[era]} · ${HOUSE_PRICES[price]}`,
    specs: `${built.stories} ${built.stories === 1 ? "story" : "stories"} · ${Math.round(envelope.lengthM)}×${Math.round(envelope.widthM)}m · ${Math.floor(built.beds.length / 2)} ${built.beds.length === 2 ? "bedroom" : "bedrooms"}`,
    materials: built.materials,
    blocks: built.blocks,
    floors,
    spawn: built.spawn,
    chests: built.chests,
    beds: built.beds,
    footprint: {
      shape: archetype.label,
      bearingDeg: displayBearing,
      lengthM: envelope.lengthM,
      widthM: envelope.widthM,
      cells: projected.cells,
    },
  };
}
