import { Block as B, type BlockId } from "@/lib/blocks";
import type { CommercialType } from "./catalog";
import type { CommercialBuilding, CommercialChest, CommercialLootLocation, LootStack, ResolvedStoreType } from "./generate";
import type { CommercialEnvelope, CommercialPlan, CommercialRoomUse, CommercialVolume } from "./plan";

type BuildMaterials = {
  type: Exclude<CommercialType, "any">;
  storeType: ResolvedStoreType;
  rank: number;
  wall: BlockId;
  accent: BlockId;
  trim: BlockId;
  roofBlock: BlockId;
  awningBlock: BlockId;
};

export function buildCommercial(
  plan: CommercialPlan,
  m: BuildMaterials,
  random: () => number,
  loot: (label: CommercialLootLocation) => LootStack[],
): Pick<CommercialBuilding, "blocks" | "beds" | "chests" | "spawn" | "floors"> {
  const cells = new Map<string, BlockId>();
  const chests: CommercialChest[] = [];
  const beds: CommercialBuilding["beds"] = [];
  const h = plan.storyHeight;

  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, b: BlockId | null) =>
    b === null ? cells.delete(key(x, y, z)) : cells.set(key(x, y, z), b);
  const fill = (
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    b: BlockId | null,
  ) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          set(x, y, z, b);
        }
      }
    }
  };

  const inside = (v: Pick<CommercialVolume, "x" | "z" | "w" | "d">, x: number, z: number) =>
    x >= v.x && x < v.x + v.w && z >= v.z && z < v.z + v.d;
  const interior = (v: Pick<CommercialVolume, "x" | "z" | "w" | "d">, x: number, z: number) =>
    x > v.x && x < v.x + v.w - 1 && z > v.z && z < v.z + v.d - 1;

  const isStorefrontType =
    m.type === "sherman_storefront" ||
    m.type === "strip_plaza" ||
    m.type === "cafe_diner" ||
    m.type === "office_midrise" ||
    m.type === "lakefront_lodge";

  const floorBlockFor = (use: CommercialRoomUse): BlockId => {
    if (use === "Warehouse bay" || use === "Service bay" || use === "Stockroom") return B.LightGrayConcrete;
    if (use === "Commercial kitchen" || use === "Restroom") return B.Quartz;
    if (use === "Lobby" && m.type === "office_midrise") return B.Quartz;
    if (use === "Dining room" || use === "Guest suite" || m.type === "lakefront_lodge") return B.StoneBricks;
    return B.Clay;
  };

  // 1. Site foundation, sidewalk, and parking lot
  let siteMinX = Infinity;
  let siteMaxX = -Infinity;
  let siteMaxZ = -Infinity;
  for (const e of plan.envelopes) {
    siteMinX = Math.min(siteMinX, e.x);
    siteMaxX = Math.max(siteMaxX, e.x + e.w - 1);
    siteMaxZ = Math.max(siteMaxZ, e.z + e.d - 1);
  }

  // Front sidewalk & site paving
  if (plan.industrialStyle === "tiltup_distribution") {
    // Photo 3: Expansive light-gray concrete truck apron + grass verge + front sidewalk
    fill(siteMinX - 2, -1, siteMaxZ + 1, siteMaxX + 2, -1, siteMaxZ + 6, B.LightGrayConcrete);
    fill(siteMinX - 2, -1, siteMaxZ + 7, siteMaxX + 2, -1, siteMaxZ + 8, B.Grass);
    fill(siteMinX - 2, -1, siteMaxZ + 9, siteMaxX + 2, -1, siteMaxZ + 10, B.LightGrayConcrete);
  } else {
    // Front sidewalk along z = siteMaxZ + 1 .. siteMaxZ + 2
    fill(siteMinX - 1, -1, siteMaxZ + 1, siteMaxX + 1, -1, siteMaxZ + 2, B.LightGrayConcrete);

    if (plan.hasParking) {
      const lotZ1 = siteMaxZ + 3;
      const lotZ2 = siteMaxZ + 9;
      fill(siteMinX - 2, -1, lotZ1, siteMaxX + 2, -1, lotZ2, B.GrayConcrete);
      // Crisp white parking stall stripes for showroom warehouse (Photo 2), yellow for others
      const stripeBlock = plan.industrialStyle === "showroom_warehouse" ? B.WhiteConcrete : B.YellowConcrete;
      for (let sx = siteMinX; sx <= siteMaxX; sx += 4) {
        fill(sx, -1, lotZ1 + 1, sx, -1, lotZ1 + 4, stripeBlock);
      }
    }
  }

  const isCoveredAt = (x: number, z: number, y: number) =>
    plan.volumes.some((other) => inside(other, x, z) && other.stories * h > y);

  // 2. Main shells, interior partitions, floors, and commercial glazing
  for (const v of plan.volumes) {
    const x2 = v.x + v.w - 1;
    const z2 = v.z + v.d - 1;
    fill(v.x, -1, v.z, x2, -1, z2, m.accent);

    const body = plan.envelopes.find((e) => e.rooms.includes(v.id))!;
    const isLodge = m.type === "lakefront_lodge";
    const isIndustrial = m.type === "warehouse" || m.type === "auto_shop";
    const isOffice = m.type === "office_midrise";

    for (let y = 0; y < v.stories * h; y++) {
      const localY = y % h;
      const story = Math.floor(y / h);
      for (let x = v.x; x <= x2; x++) {
        for (let z = v.z; z <= z2; z++) {
          const edge = !interior(v, x, z);
          if (localY === 0) {
            set(x, y, z, floorBlockFor(v.use));
            continue;
          }
          if (!edge) continue;

          // A wall cell is exterior whenever any cardinal neighbor is outside all volumes at this height.
          // This guarantees interior partition walls never cut through the outer facade or white outline.
          const exterior =
            !isCoveredAt(x - 1, z, y) ||
            !isCoveredAt(x + 1, z, y) ||
            !isCoveredAt(x, z - 1, y) ||
            !isCoveredAt(x, z + 1, y);
          const corner =
            (x === body.x || x === body.x + body.w - 1) &&
            (z === body.z || z === body.z + body.d - 1);
          const isFrontFace = z === z2 && exterior && z === body.z + body.d - 1;
          const along = x === v.x || x === x2 ? z - v.z : x - v.x;
          const span = x === v.x || x === x2 ? v.d : v.w;

          if (!exterior) {
            set(x, y, z, B.LightGrayConcrete);
            continue;
          }

          if (corner) {
            set(x, y, z, m.trim);
            continue;
          }

          // Base wainscot / kickplate on ground floor
          if (story === 0 && localY === 1) {
            if (isOffice && isFrontFace && along > 1 && along < span - 2 && along % 4 !== 0) {
              set(x, y, z, B.Glass);
            } else {
              set(x, y, z, m.accent);
            }
            continue;
          }

          // Top spandrel / cornice outline band around every story
          if (localY === h - 1) {
            set(x, y, z, m.trim);
            continue;
          }

          // Window logic by building archetype (front second story stays solid for the large sign)
          let isWindow = false;
          const ind = plan.industrialStyle;
          if (story === 1 && isFrontFace) {
            isWindow = false;
          } else if (ind === "contractor_shop") {
            if (v.use === "Office suite") {
              isWindow = isFrontFace
                ? along > 1 && along < span - 2 && localY >= 2 && localY <= 3
                : along > 1 && along < span - 2 && along % 5 === 2 && (localY === 2 || localY === h - 2);
            } else {
              // Photo 1: solid front wall (for bay door), high under-eave transom windows along sides
              isWindow =
                !isFrontFace &&
                along > 1 &&
                along < span - 2 &&
                (along % 5 === 2 || along % 5 === 3) &&
                localY === h - 2;
            }
          } else if (ind === "showroom_warehouse") {
            // Photo 2: wide ground-floor showroom display glazing across the front facade
            isWindow =
              isFrontFace &&
              v.use === "Retail floor" &&
              along > 1 &&
              along < span - 2 &&
              along % 5 !== 0 &&
              localY >= 1 &&
              localY <= 3;
          } else if (ind === "tiltup_distribution") {
            // Photo 3: solid tilt-up warehouse panels + integrated 2-tier office windows on right end
            if (v.use === "Office suite" && isFrontFace) {
              isWindow =
                along >= 1 &&
                along < span - 1 &&
                along % 4 !== 0 &&
                (localY === 1 || localY === 2 || localY === 4 || localY === 5);
            } else {
              isWindow = false;
            }
          } else if (isIndustrial) {
            if (v.use === "Office suite" || v.use === "Lobby") {
              isWindow = along > 1 && along < span - 2 && along % 3 !== 0 && localY >= 2 && localY <= 3;
            } else {
              // High ribbon clerestory windows
              isWindow = along > 1 && along < span - 2 && along % 4 !== 0 && localY === h - 2;
            }
          } else if (isOffice) {
            // Curtain-wall glass bays with vertical mullions every 4 blocks
            isWindow = along > 1 && along < span - 2 && along % 4 !== 0 && localY >= 2 && localY <= h - 2;
          } else if (isStorefrontType && story === 0 && isFrontFace) {
            // Wide street-facing storefront display glass
            isWindow = along > 1 && along < span - 2 && along % 5 !== 0 && localY >= 2 && localY <= h - 2;
          } else if (isLodge) {
            isWindow = along > 1 && along < span - 2 && along % 4 !== 0 && localY >= 2 && localY <= h - 2;
          } else {
            // Upper stories & side elevations
            isWindow =
              v.use !== "Stockroom" &&
              v.use !== "Restroom" &&
              along > 1 &&
              along < span - 2 &&
              (along % 4 === 2 || along % 4 === 3) &&
              localY >= 2 &&
              localY <= h - 2;
          }

          if (isWindow) {
            set(x, y, z, B.Glass);
          } else if (ind === "tiltup_distribution") {
            // Photo 3: Crisp smooth Light Gray Concrete tilt-up panels with scored vertical & horizontal joint lines
            const isJoint = localY === 3 || along % 4 === 0;
            set(x, y, z, isJoint ? B.Clay : B.LightGrayConcrete);
          } else if ((isOffice || isLodge) && along % 4 === 0) {
            set(x, y, z, m.trim);
          } else {
            set(x, y, z, m.wall);
          }
        }
      }
    }
  }

  // 3. Continuous top-floor ceilings + roof structures
  for (const e of plan.envelopes) {
    const topY = e.stories * h;
    const x2 = e.x + e.w - 1;
    const z2 = e.z + e.d - 1;

    // Ceiling / flat deck slab
    for (let x = e.x; x <= x2; x++) {
      for (let z = e.z; z <= z2; z++) {
        // Don't overwrite interior of a taller adjacent envelope
        const blockedByTaller = plan.volumes.some(
          (other) => inside(other, x, z) && other.stories * h > topY,
        );
        if (blockedByTaller) continue;
        set(x, topY, z, e.roof === "parapet" ? m.roofBlock : B.WhiteTerracotta);
      }
    }

    if (e.roof === "parapet") {
      // Raised commercial parapet wall around perimeter + coping trim
      const parapetH = m.type === "sherman_storefront" || m.type === "strip_plaza" ? 2 : 1;
      for (let x = e.x; x <= x2; x++) {
        for (let z = e.z; z <= z2; z++) {
          const onEdge = x === e.x || x === x2 || z === e.z || z === z2;
          if (!onEdge) continue;
          const blockedByTaller = plan.volumes.some(
            (other) => inside(other, x, z) && other.stories * h > topY + 1,
          );
          if (blockedByTaller) continue;
          for (let py = 1; py <= parapetH; py++) {
            const isFrontSignBand = z === z2 && py === 1 && (m.type === "strip_plaza" || m.type === "sherman_storefront");
            set(x, topY + py, z, py === parapetH ? m.trim : isFrontSignBand ? m.accent : m.wall);
          }
        }
      }

      // Rooftop HVAC mechanical units
      if (plan.hasRooftopHvac && e.w >= 9 && e.d >= 8) {
        const hx = e.x + Math.floor(e.w / 2) - 2;
        const hz = e.z + Math.floor(e.d / 2) - 1;
        fill(hx, topY + 1, hz, hx + 3, topY + 2, hz + 2, B.LightGrayConcrete);
        set(hx + 1, topY + 2, hz + 1, B.GrayConcrete);
        set(hx + 2, topY + 2, hz + 1, B.GrayConcrete);
        if (e.w >= 16) {
          const hx2 = e.x + 3;
          fill(hx2, topY + 1, hz, hx2 + 2, topY + 2, hz + 1, B.GrayConcrete);
        }
      }
    } else {
      // Pitched roofs: gable, hip, shed, or clerestory
      buildPitchedRoof(e, topY, m, set, fill, plan.industrialStyle === "contractor_shop");
    }
  }

  // 4. Front awnings / canopies over storefronts (striped with White Wool or solid in any color)
  const stripedCanopy = random() < 0.5;
  if (plan.awningDepth > 0) {
    const awningY = 4;
    for (const e of plan.envelopes) {
      if (e.z + e.d - 1 !== 0) continue;
      for (let x = e.x + 1; x <= e.x + e.w - 2; x++) {
        for (let dz = 1; dz <= plan.awningDepth; dz++) {
          const block = stripedCanopy && x % 2 === 0 ? B.WhiteWool : m.awningBlock;
          set(x, awningY, dz, block);
        }
      }
    }
  }

  // 4b. Large framed sign across the front second story (instead of windows)
  for (const e of plan.envelopes) {
    if (e.stories < 2 || e.w < 9) continue;
    const z2 = e.z + e.d - 1;
    if (z2 !== 0) continue;
    const signX1 = e.x + 2;
    const signX2 = e.x + e.w - 3;
    const signY1 = h + 1;
    const signY2 = h + h - 2;
    const midY = Math.floor((signY1 + signY2) / 2);
    const signZ = z2 + 1;
    for (let x = signX1; x <= signX2; x++) {
      for (let y = signY1; y <= signY2; y++) {
        const isEdge = x === signX1 || x === signX2;
        const isLetter = !isEdge && y === midY && x >= signX1 + 2 && x <= signX2 - 2 && (x - signX1) % 3 !== 0;
        set(x, y, signZ, isEdge ? m.trim : isLetter ? B.WhiteConcrete : B.BlackConcrete);
      }
    }
  }

  // 4c. Local Coeur d'Alene industrial facade features (bay hoods, fascia canopies, bollards, sign plaques)
  if (plan.industrialStyle === "contractor_shop") {
    // Photo 1: Sloped dark metal shed hoods over BOTH the tall roll-up bay door and the front office entry
    for (const bay of plan.bayDoors) {
      if (bay.side) continue;
      for (let x = bay.x - 2; x <= bay.x + 2; x++) {
        set(x, bay.height + 1, 1, B.RoofTiles);
        set(x, bay.height, 2, B.RoofTiles);
      }
      set(bay.x - 2, bay.height, 1, m.trim);
      set(bay.x + 2, bay.height, 1, m.trim);
    }
    for (const entry of plan.entries) {
      for (let x = entry.x - 1; x <= entry.x + 3; x++) {
        set(x, 4, 1, B.RoofTiles);
        set(x, 3, 2, B.RoofTiles);
      }
      set(entry.x - 1, 3, 1, m.trim);
      set(entry.x + 3, 3, 1, m.trim);
    }
  } else if (plan.industrialStyle === "showroom_warehouse") {
    // Photo 2 (National Mattress & Furniture):
    // Deep 3-block overhanging front fascia canopy supported by piers, stepped tall mansard fascia,
    // prominent peaked entrance gable pediment, and 3 large rectangular brand billboard plaques.
    const main = plan.envelopes[0]!;
    const x1 = main.x;
    const x2 = main.x + main.w - 1;
    const entryX = plan.entries[0]?.x ?? x1 + Math.floor(main.w * 0.28);
    const rightStepX = x1 + Math.floor(main.w * 0.62);

    // Corner & entrance support piers under the 3-block deep canopy
    for (const px of [x1, entryX - 3, entryX + 3, x2]) {
      if (px >= x1 && px <= x2) fill(px, 0, 3, px, 3, 3, m.accent);
    }
    // Deep canopy soffit (y = 4) and stepped mansard fascia (y = 5..6, stepping up to y = 7 on right wing)
    fill(x1, 4, 1, x2, 4, 3, m.trim);
    fill(x1, 5, 1, x2, 5, 3, B.LightGrayConcrete);
    fill(x1, 6, 1, x2, 6, 3, B.GrayConcrete);
    fill(rightStepX, 7, 1, x2, 7, 3, B.GrayConcrete);

    // Prominent peaked triangular gable pediment over the main entrance
    fill(entryX - 3, 7, 2, entryX + 3, 7, 3, B.GreenTerracotta);
    fill(entryX - 2, 8, 2, entryX + 2, 8, 3, B.GreenTerracotta);
    fill(entryX - 1, 9, 2, entryX + 1, 9, 3, m.trim);
    set(entryX, 10, 3, m.trim);

    // Three giant crisp white brand billboard plaques mounted on the front fascia (z = 4)
    const plaques: [number, number, number][] = [
      [Math.max(x1 + 1, entryX - 4), Math.min(x2 - 1, entryX + 4), 5],
      [Math.min(x2 - 8, entryX + 7), Math.min(x2 - 2, entryX + 13), 5],
      [Math.max(rightStepX + 1, x2 - 8), x2 - 2, 6],
    ];
    for (const [px1, px2, baseY] of plaques) {
      if (px2 - px1 < 4) continue;
      for (let x = px1; x <= px2; x++) {
        set(x, baseY, 4, x > px1 && x < px2 && x % 2 === 0 ? B.BlackConcrete : B.WhiteConcrete);
        set(x, baseY + 1, 4, B.WhiteConcrete);
      }
    }
  } else if (plan.industrialStyle === "tiltup_distribution") {
    // Photo 3 (Sierra Lumber):
    // Bright yellow 2-block-tall safety bollards flanking the truck bay, wall floodlights,
    // tall high-mounted colored company sign plaque, and colored entry canopy on the right-end office.
    const main = plan.envelopes[0]!;
    for (const bay of plan.bayDoors) {
      if (bay.side) continue;
      const half = Math.floor(bay.width / 2);
      // Yellow safety bollards on both sides of the loading bay
      fill(bay.x - half - 1, 0, 1, bay.x - half - 1, 1, 1, B.YellowConcrete);
      fill(bay.x + (bay.width - half), 0, 1, bay.x + (bay.width - half), 1, 1, B.YellowConcrete);
      // High exterior floodlight above bay
      set(bay.x, 6, 1, B.SeaLantern);
    }
    // Tall centered high-mounted company sign plaque (like the green Sierra Lumber sign)
    const signCx = main.x + Math.floor(main.w * 0.48);
    for (let x = signCx - 2; x <= signCx + 2; x++) {
      for (let y = 4; y <= 6; y++) {
        const isLogo = y === 5 && x >= signCx - 1 && x <= signCx + 1;
        set(x, y, 1, isLogo ? B.WhiteConcrete : B.GreenTerracotta);
      }
    }
    // Second exterior floodlight on the left tilt-up bay
    set(main.x + 5, 6, 1, B.SeaLantern);
    // Colored canopy awning over the flush right-end office entrance
    for (const entry of plan.entries) {
      for (let x = entry.x - 1; x <= entry.x + 2; x++) {
        set(x, 3, 1, m.awningBlock);
        set(x, 3, 2, m.awningBlock);
      }
    }
  }

  // 5. Outdoor covered patio for cafe / lakefront lodge (no wood or wool)
  if (plan.patio) {
    const p = plan.patio;
    const px2 = p.x + p.w - 1;
    const pz2 = p.z + p.d - 1;
    fill(p.x, 0, p.z, px2, 0, pz2, m.accent);
    fill(p.x, -1, p.z, px2, -1, pz2, m.trim);
    // Low stone perimeter curb with entry gap
    const midX = Math.floor(p.x + p.w / 2);
    for (let x = p.x; x <= px2; x++) {
      if (Math.abs(x - midX) > 1) set(x, 1, pz2, B.StoneBricks);
    }
    for (let z = p.z; z <= pz2; z++) {
      set(p.x, 1, z, B.StoneBricks);
      set(px2, 1, z, B.StoneBricks);
    }
    if (p.covered) {
      // Corner outline posts + canopy cover (striped or solid)
      for (const cx of [p.x, px2]) {
        for (const cz of [p.z, pz2]) {
          fill(cx, 1, cz, cx, 3, cz, m.trim);
        }
      }
      for (let x = p.x; x <= px2; x++) {
        for (let z = p.z; z <= pz2; z++) {
          const isBorder = x === p.x || x === px2 || z === p.z || z === pz2;
          const block = isBorder ? m.trim : stripedCanopy && x % 2 === 0 ? B.WhiteWool : m.awningBlock;
          set(x, 4, z, block);
        }
      }
    }
  }

  // 6. Doors (interior connections + front entrances) & bay doors
  const placeDoor = (x: number, z: number, side: boolean, y = 0) => {
    set(x, y + 1, z, side ? B.OakDoorEastLower : B.OakDoorLower);
    set(x, y + 2, z, side ? B.OakDoorEastUpper : B.OakDoorUpper);
    set(x, y + 3, z, m.wall);
  };

  for (const c of plan.connections) {
    placeDoor(c.x, c.z, c.side, 0);
    const maxShared = Math.min(plan.volumes[c.a]!.stories, plan.volumes[c.b]!.stories);
    for (let s = 1; s < maxShared; s++) {
      placeDoor(c.x, c.z, c.side, s * h);
    }
  }

  for (const entry of plan.entries) {
    placeDoor(entry.x, entry.z, false, 0);
  }

  // Place exterior lanterns strictly in the solid wall gaps between first-story front windows
  const isDoorOrAir = (b: BlockId | undefined) =>
    b === undefined ||
    b === B.Glass ||
    b === B.OakDoorLower ||
    b === B.OakDoorUpper ||
    b === B.OakDoorEastLower ||
    b === B.OakDoorEastUpper;

  for (const e of plan.envelopes) {
    const z2 = e.z + e.d - 1;
    for (let x = e.x + 2; x <= e.x + e.w - 3; x++) {
      const center = cells.get(key(x, 2, z2));
      const left = cells.get(key(x - 1, 2, z2));
      const right = cells.get(key(x + 1, 2, z2));
      if (!isDoorOrAir(center) && left === B.Glass && right === B.Glass) {
        set(x, 3, z2 + 1, B.Lantern);
      }
    }
  }

  for (const bay of plan.bayDoors) {
    const half = Math.floor(bay.width / 2);
    for (let t = -half; t < bay.width - half; t++) {
      const bx = bay.x + (bay.side ? 0 : t);
      const bz = bay.z + (bay.side ? t : 0);
      if (plan.industrialStyle === "contractor_shop" && !bay.side) {
        // Photo 1: Tall white sectional roll-up garage door with horizontal glass transom window row
        for (let by = 1; by < bay.height; by++) {
          set(bx, by, bz, by === 3 ? B.Glass : B.WhiteConcrete);
        }
        set(bx, bay.height, bz, B.WhiteConcrete);
      } else {
        // Open truck loading bay with roll-up door header at top
        fill(bx, 1, bz, bx, bay.height - 1, bz, null);
        set(bx, bay.height, bz, B.LightGrayConcrete);
      }
      // Concrete apron outside bay
      for (let d = 1; d <= 4; d++) {
        set(bx + bay.dx * d, -1, bz + bay.dz * d, B.LightGrayConcrete);
      }
    }
  }

  // 7. Interior furnishings, multi-story stairs, lighting, and stocked chests
  const maxStories = Math.max(...plan.volumes.map((v) => v.stories));
  const roomNames: string[][] = Array.from({ length: maxStories }, () => []);
  let safePlaced = false;

  for (const v of plan.volumes) {
    const cx = Math.floor(v.x + v.w / 2);
    const cz = Math.floor(v.z + v.d / 2);
    const exits = plan.connections.filter((c) => c.a === v.id || c.b === v.id);
    const reserved = new Set<string>();
    const reserve = (x: number, z: number) => reserved.add(`${x},${z}`);
    const route = (x: number, z: number) => {
      const ix = Math.max(v.x + 1, Math.min(v.x + v.w - 2, x));
      const iz = Math.max(v.z + 1, Math.min(v.z + v.d - 2, z));
      for (let xx = Math.min(ix, cx); xx <= Math.max(ix, cx); xx++) reserve(xx, iz);
      for (let zz = Math.min(iz, cz); zz <= Math.max(iz, cz); zz++) reserve(cx, zz);
      reserve(x, z);
    };

    exits.forEach((c) => route(c.x, c.z));
    for (const entry of plan.entries) {
      if (inside(v, entry.x, entry.z)) route(entry.x, entry.z);
    }
    for (const bay of plan.bayDoors) {
      if (inside(v, bay.x, bay.z)) {
        for (let t = -2; t <= 2; t++) {
          route(bay.x + (bay.side ? 0 : t), bay.z + (bay.side ? t : 0));
        }
      }
    }

    // Reserve stairwell tucked cleanly against the back-left wall of primary multi-story volume (v.id === 0)
    const hasStairs = v.id === 0 && v.stories > 1 && v.w >= h + 4;
    if (hasStairs) {
      for (let x = v.x + 1; x <= Math.min(v.x + v.w - 2, v.x + h + 2); x++) {
        reserve(x, v.z + 1);
        reserve(x, v.z + 2);
      }
      route(v.x + 1, v.z + 2);
      route(Math.min(v.x + v.w - 2, v.x + h + 2), v.z + 2);
    }

    for (let story = 0; story < v.stories; story++) {
      const y = story * h;
      const use = storyUseFor(v.use, story, m.type, m.storeType);
      roomNames[story]!.push(use);

      // Ceiling light in room center
      set(cx, y + h - 1, cz, m.type === "office_midrise" || m.type === "strip_plaza" ? B.SeaLantern : B.Lantern);

      // Candidate furnishing spots (preferring wall-adjacent spots)
      const spots: { x: number; z: number; score: number }[] = [];
      for (let x = v.x + 1; x < v.x + v.w - 1; x++) {
        for (let z = v.z + 1; z < v.z + v.d - 1; z++) {
          const nearWall = x === v.x + 1 || x === v.x + v.w - 2 || z === v.z + 1 || z === v.z + v.d - 2;
          spots.push({ x, z, score: random() + (nearWall ? 2 : 0) });
        }
      }
      spots.sort((a, b) => b.score - a.score);

      const free = (x: number, z: number) =>
        interior(v, x, z) && !reserved.has(`${x},${z}`) && !cells.has(key(x, y + 1, z));

      const put = (block: BlockId, label?: CommercialLootLocation, near?: { x: number; z: number }) => {
        const available = spots.filter((p) => free(p.x, p.z));
        if (available.length === 0) return null;
        if (near) {
          available.sort(
            (a, b) =>
              Math.abs(a.x - near.x) + Math.abs(a.z - near.z) -
              (Math.abs(b.x - near.x) + Math.abs(b.z - near.z)),
          );
        }
        const pos = available[0]!;
        set(pos.x, y + 1, pos.z, block);
        if (label) chests.push({ x: pos.x, y: y + 1, z: pos.z, label, items: loot(label) });
        return pos;
      };

      const placeChest = (x: number, cy: number, z: number, label: CommercialLootLocation) => {
        set(x, cy, z, B.Chest);
        chests.push({ x, y: cy, z, label, items: loot(label) });
      };

      /** Place a Large Chest (2 adjacent chest blocks), optionally stacked 2 high. */
      const placeLargeChest = (
        x1: number,
        z1: number,
        x2: number,
        z2: number,
        label: CommercialLootLocation,
        stacked = true,
      ) => {
        placeChest(x1, y + 1, z1, label);
        placeChest(x2, y + 1, z2, label);
        if (stacked && h >= 5) {
          placeChest(x1, y + 2, z1, label);
          placeChest(x2, y + 2, z2, label);
        }
      };

      if (use === "Retail floor") {
        const isClothing = m.storeType === "clothing";
        const roomMinX = v.x + 1;
        const roomMaxX = v.x + v.w - 2;
        const roomMinZ = v.z + 1;
        const roomMaxZ = v.z + v.d - 2;

        // Find the front entry for this room so the front desk sits cleanly off to one side
        const roomEntry = plan.entries.find((e) => inside(v, e.x, e.z));
        const entryX = roomEntry?.x ?? cx;

        // 1. Refined Front Checkout Desk: tucked cleanly on the front-left (or front-right)
        // with a 1-block-wide worker lane directly behind it at z = roomMaxZ
        const deskZ = roomMaxZ - 1;
        if (story === 0 && deskZ > roomMinZ + 3) {
          const leftRoom = entryX - 2 - roomMinX;
          const onLeft = leftRoom >= 2;
          const deskX1 = onLeft ? roomMinX : Math.min(roomMaxX - 2, entryX + 2);
          const deskX2 = onLeft ? Math.min(roomMinX + 3, entryX - 2) : Math.min(roomMaxX, deskX1 + 3);

          if (deskX2 >= deskX1 + 1) {
            // Reserve 1-block worker lane behind desk + open side entry for worker
            for (let dx = deskX1; dx <= deskX2; dx++) {
              reserve(dx, roomMaxZ);
            }
            const workerEntryX = onLeft ? deskX2 + 1 : deskX1 - 1;
            if (workerEntryX >= roomMinX && workerEntryX <= roomMaxX) {
              reserve(workerEntryX, roomMaxZ);
              reserve(workerEntryX, deskZ);
            }

            // Place a Large Chest (2 blocks wide) as the Cash Register + counter surface
            if (free(deskX1, deskZ) && free(deskX1 + 1, deskZ)) {
              placeLargeChest(deskX1, deskZ, deskX1 + 1, deskZ, "Cash register", false);
            }
            for (let dx = deskX1 + 2; dx <= deskX2; dx++) {
              if (!free(dx, deskZ)) continue;
              set(dx, y + 1, deskZ, dx === deskX1 + 2 ? B.CraftingTable : B.QuartzSlab);
            }
          }
        }

        // 2. Clean, aligned rows of 2-high Large Chests (and Armor Stand mannequins in clothing stores)
        // separated by 2-block-wide aisles with Hanging Signs with chains from the ceiling
        const aisleMinZ = roomMinZ + (hasStairs ? 2 : 1);
        const aisleMaxZ = Math.max(aisleMinZ + 1, deskZ - 2);
        let aisleIndex = 0;

        for (let rowX = roomMinX + 1; rowX <= roomMaxX - 1; rowX += 3) {
          let placedInRow = false;
          if (isClothing && aisleIndex % 2 === 1) {
            // Armor Stand mannequins spaced neatly along the display row
            for (let rz = aisleMinZ; rz <= aisleMaxZ; rz += 2) {
              if (!free(rowX, rz)) continue;
              set(rowX, y + 1, rz, B.ArmorStand);
              placedInRow = true;
            }
          } else {
            // Rows of Large Chests (2 adjacent chests along Z), always stacked 2 high
            for (let rz = aisleMinZ; rz + 1 <= aisleMaxZ; rz += 3) {
              if (!free(rowX, rz) || !free(rowX, rz + 1)) continue;
              placeLargeChest(rowX, rz, rowX, rz + 1, "Front aisle", true);
              placedInRow = true;
            }
          }

          // Hang a Minecraft Hanging Sign (with chains) from the ceiling centered over the 2-block aisle
          if (placedInRow && rowX + 2 <= roomMaxX) {
            const signZ = Math.min(aisleMaxZ, roomMaxZ - 2);
            set(rowX + 1, y + h - 2, signZ, B.HangingSign);
          }
          aisleIndex++;
        }

        // Fallback if a narrow wing had no room for a full row: place at least one 2-high Large Chest
        if (!chests.some((c) => c.label === "Front aisle" && c.y === y + 1)) {
          const pairSpot = spots.find((p) => free(p.x, p.z) && free(p.x, p.z + 1));
          if (pairSpot) {
            placeLargeChest(pairSpot.x, pairSpot.z, pairSpot.x, pairSpot.z + 1, "Front aisle", true);
          } else {
            put(B.Chest, "Front aisle");
          }
        }
      } else if (use === "Changing rooms") {
        // Clothing store back section: row of changing room stalls separated by 2-block-high grey stone brick walls
        // with hanging curtain banners instead of doors and a bench inside each stall.
        const stallBackZ = v.z + 1;
        const stallFrontZ = Math.min(v.z + v.d - 3, stallBackZ + 2);
        const stallSpan = 3; // 2-block interior width + 1-block divider wall
        let stallsPlaced = 0;

        for (let sx = v.x + 1; sx + 2 <= v.x + v.w - 2; sx += stallSpan) {
          const wallX = sx;
          const stallMidX = sx + 1;
          const stallRightX = sx + 2;

          // Skip if this stall overlaps a doorway route
          let blocked = false;
          for (let xx = wallX; xx <= stallRightX; xx++) {
            for (let zz = stallBackZ; zz <= stallFrontZ; zz++) {
              if (reserved.has(`${xx},${zz}`)) blocked = true;
            }
          }
          if (blocked) continue;

          // 2-block-high grey stone brick wall/fence divider on left of stall
          if (wallX > v.x + 1) {
            for (let zz = stallBackZ; zz <= stallFrontZ; zz++) {
              set(wallX, y + 1, zz, B.StoneBrickWall);
              set(wallX, y + 2, zz, B.StoneBrickWall);
            }
          }
          // Right divider wall closing the last stall
          const nextWallX = sx + stallSpan;
          if (nextWallX <= v.x + v.w - 2) {
            for (let zz = stallBackZ; zz <= stallFrontZ; zz++) {
              set(nextWallX, y + 1, zz, B.StoneBrickWall);
              set(nextWallX, y + 2, zz, B.StoneBrickWall);
            }
          }
          // Hanging curtain banners across the front of the changing room stall (instead of doors)
          set(stallMidX, y + 2, stallFrontZ, B.CurtainBanner);
          set(stallRightX, y + 2, stallFrontZ, B.CurtainBanner);
          // Bench inside stall
          set(stallMidX, y + 1, stallBackZ, B.QuartzSlab);
          stallsPlaced++;
        }

        // Add an Armor Stand outside the changing rooms if space permits
        if (stallsPlaced > 0) {
          const standSpot = spots.find((p) => free(p.x, p.z) && p.z > stallFrontZ);
          if (standSpot) set(standSpot.x, y + 1, standSpot.z, B.ArmorStand);
        }
      } else if (use === "Dining room") {
        const counter = put(B.QuartzSlab);
        if (counter) put(B.Chest, "Cash register", counter);
        put(B.Quartz);
        put(B.OakStairNorth);
        put(B.OakStairSouth);
      } else if (use === "Commercial kitchen") {
        const stove = put(B.Furnace);
        if (stove) {
          put(B.Furnace, undefined, stove);
          put(B.CraftingTable, undefined, stove);
          put(B.Chest, "Commercial kitchen", stove);
        }
      } else if (use === "Lobby") {
        const desk = put(B.QuartzSlab);
        if (desk) {
          put(B.LightGrayConcrete, undefined, desk);
          put(B.Chest, story === 0 ? "Cash register" : "Supply room", desk);
        }
        put(B.Bookshelf);
      } else if (use === "Office suite") {
        const desk = put(B.QuartzSlab);
        if (desk) put(B.CraftingTable, undefined, desk);
        put(B.Bookshelf);
        if (!safePlaced && (m.rank >= 1 || story > 0)) {
          put(B.Chest, "Manager safe");
          safePlaced = true;
        } else {
          put(B.Chest, "Supply room");
        }
      } else if (use === "Conference room") {
        const tbl = put(B.Quartz);
        if (tbl) put(B.Quartz, undefined, tbl);
        put(B.Bookshelf);
      } else if (use === "Stockroom") {
        // Back of storefront: rows of fully stocked Large Chests (2 adjacent, stacked 2 high)
        // with the exact same store-type items as the front
        let pairsPlaced = 0;
        for (let sx = v.x + 1; sx <= v.x + v.w - 2; sx += 3) {
          for (let sz = v.z + 1; sz + 1 <= v.z + v.d - 2; sz += 3) {
            if (!free(sx, sz) || !free(sx, sz + 1)) continue;
            placeLargeChest(sx, sz, sx, sz + 1, "Backroom stock", true);
            pairsPlaced++;
            if (pairsPlaced >= 4) break;
          }
          if (pairsPlaced >= 4) break;
        }
        if (pairsPlaced === 0) {
          const pairSpot = spots.find((p) => free(p.x, p.z) && free(p.x + 1, p.z));
          if (pairSpot) {
            placeLargeChest(pairSpot.x, pairSpot.z, pairSpot.x + 1, pairSpot.z, "Backroom stock", true);
          } else {
            put(B.Chest, "Backroom stock");
          }
        }
      } else if (use === "Warehouse bay") {
        // Organized industrial pallet rack rows (2-high Large Chests + stone brick rack uprights)
        // separated by 2-block-wide forklift aisles, plus packing workbench
        const bayMinX = v.x + 1;
        const bayMaxX = v.x + v.w - 2;
        const bayMinZ = v.z + 1;
        const bayMaxZ = v.z + v.d - 3;
        let racksPlaced = 0;

        for (let rx = bayMinX + 1; rx <= bayMaxX - 1; rx += 3) {
          for (let rz = bayMinZ + 1; rz + 1 <= bayMaxZ; rz += 3) {
            if (!free(rx, rz) || !free(rx, rz + 1)) continue;
            placeLargeChest(rx, rz, rx, rz + 1, "Shipping crate", true);
            if (free(rx, rz - 1)) {
              set(rx, y + 1, rz - 1, B.StoneBrickWall);
              set(rx, y + 2, rz - 1, B.StoneBrickWall);
            }
            racksPlaced++;
          }
        }
        put(B.CraftingTable);
        if (racksPlaced === 0) {
          put(B.Chest, "Shipping crate");
        }
      } else if (use === "Service bay") {
        const bench = put(B.CraftingTable);
        if (bench) {
          put(B.Furnace, undefined, bench);
          put(B.Chest, "Parts & tools", bench);
        }
        put(B.Chest, "Parts & tools");
      } else if (use === "Break room") {
        // Employee breakroom: table and chairs + coffee/microwave counter + breakroom chest
        const tableSpot = spots.find(
          (p) => free(p.x, p.z) && free(p.x, p.z - 1) && free(p.x, p.z + 1),
        );
        if (tableSpot) {
          set(tableSpot.x, y + 1, tableSpot.z, B.Quartz);
          set(tableSpot.x, y + 1, tableSpot.z - 1, B.OakStairSouth);
          set(tableSpot.x, y + 1, tableSpot.z + 1, B.OakStairNorth);
          if (free(tableSpot.x + 1, tableSpot.z)) {
            set(tableSpot.x + 1, y + 1, tableSpot.z, B.Quartz);
            if (free(tableSpot.x + 1, tableSpot.z - 1)) set(tableSpot.x + 1, y + 1, tableSpot.z - 1, B.OakStairSouth);
            if (free(tableSpot.x + 1, tableSpot.z + 1)) set(tableSpot.x + 1, y + 1, tableSpot.z + 1, B.OakStairNorth);
          }
        } else {
          put(B.Quartz);
          put(B.OakStairNorth);
        }
        const counter = put(B.Furnace);
        if (counter) put(B.Chest, "Employee breakroom", counter);
        else put(B.Chest, "Employee breakroom");
      } else if (use === "Restroom") {
        put(B.Quartz);
      } else if (use === "Guest suite") {
        const bedSpot = spots.find((p) => free(p.x, p.z) && free(p.x, p.z + 1));
        if (bedSpot) {
          set(bedSpot.x, y + 1, bedSpot.z, B.BedHead);
          set(bedSpot.x, y + 1, bedSpot.z + 1, B.BedFoot);
          beds.push(
            { x: bedSpot.x, y: y + 1, z: bedSpot.z },
            { x: bedSpot.x, y: y + 1, z: bedSpot.z + 1 },
          );
        }
        put(B.Bookshelf);
        put(B.Chest, "Supply room");
      }
    }

    // Build staircases tucked cleanly against the back wall, ascending East (+X) with OakStairEast
    if (hasStairs) {
      for (let s = 0; s < v.stories - 1; s++) {
        const baseY = s * h;
        for (let step = 0; step < h; step++) {
          const sx = v.x + 2 + step;
          const sz = v.z + 1;
          if (sx >= v.x + v.w - 1) break;
          set(sx, baseY + step + 1, sz, B.OakStairEast);
          // Clear headroom above stair through the next floor slab
          for (let cy = baseY + step + 2; cy <= baseY + h + 2; cy++) {
            set(sx, cy, sz, null);
          }
        }
      }
    }
  }

  const blocks = [...cells.entries()].map(([coords, block]) => {
    const [x, y, z] = coords.split(",").map(Number);
    return { x, y, z, block };
  });

  const floors = roomNames.map((rooms, story) => ({
    floorY: story * h,
    cutY: story * h + Math.min(4, h - 1),
    rooms: [...new Set(rooms)],
  }));

  const primaryEntry = plan.entries[0] ?? { x: 0, z: 0 };
  const spawnX = primaryEntry.x;
  const spawnZ = primaryEntry.z + (plan.patio && plan.patio.z > 0 ? plan.patio.d + 2 : 2);
  const spawn = { x: spawnX, y: 0, z: spawnZ };
  set(spawnX, -1, spawnZ, cells.get(key(spawnX, -1, spawnZ)) ?? B.LightGrayConcrete);
  set(spawnX, 0, spawnZ, null);
  set(spawnX, 1, spawnZ, null);

  return { blocks, beds, chests, spawn, floors };
}

function storyUseFor(
  groundUse: CommercialRoomUse,
  story: number,
  type: Exclude<CommercialType, "any">,
  storeType: ResolvedStoreType,
): CommercialRoomUse {
  // Clothing stores use the back section for Changing rooms instead of a stock/break room
  if (storeType === "clothing" && (groundUse === "Stockroom" || groundUse === "Office suite" || groundUse === "Restroom")) {
    return "Changing rooms";
  }
  if (story === 0) return groundUse;
  if (type === "lakefront_lodge") {
    return groundUse === "Lobby" ? "Lobby" : "Guest suite";
  }
  if (groundUse === "Retail floor") return "Retail floor";
  if (groundUse === "Office suite" || groundUse === "Restroom") return "Break room";
  if (groundUse === "Stockroom") return "Stockroom";
  if (groundUse === "Lobby") return "Office suite";
  return groundUse;
}

function buildPitchedRoof(
  e: CommercialEnvelope,
  topY: number,
  m: BuildMaterials,
  set: (x: number, y: number, z: number, b: BlockId | null) => void,
  fill: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, b: BlockId | null) => void,
  lowPitchShop = false,
) {
  const x1 = e.x - 1;
  const x2 = e.x + e.w;
  const z1 = e.z - 1;
  const z2 = e.z + e.d;

  for (let x = x1; x <= x2; x++) {
    for (let z = z1; z <= z2; z++) {
      const isOverhang = x < e.x || x >= e.x + e.w || z < e.z || z >= e.z + e.d;
      const dx = Math.min(x - e.x + 1, e.x + e.w - x);
      const dz = Math.min(z - e.z + 1, e.z + e.d - z);

      let rise = 0;
      if (e.roof === "gable") {
        const span = e.ridge === "x" ? dz : dx;
        rise = Math.max(0, Math.floor(span / (lowPitchShop ? 3 : 2)));
      } else if (e.roof === "hip") {
        rise = Math.max(0, Math.floor(Math.min(dx, dz) / 2));
      } else if (e.roof === "shed") {
        rise = Math.max(0, Math.floor((z - e.z + 1) / 3));
      } else if (e.roof === "clerestory") {
        // Low-slope split roof with central raised clerestory monitor
        const halfD = Math.floor(e.d / 2);
        const relZ = z - e.z;
        rise = relZ < halfD ? Math.max(0, Math.floor(relZ / 4)) : Math.max(0, Math.floor((e.d - relZ) / 4)) + 2;
      }

      const ry = topY + rise;
      set(x, ry, z, isOverhang ? m.trim : m.roofBlock);

      // Fill gable / shed / clerestory end walls beneath roof
      if (!isOverhang && rise > 0) {
        const onPerimeter = x === e.x || x === e.x + e.w - 1 || z === e.z || z === e.z + e.d - 1;
        if (onPerimeter) {
          fill(x, topY, z, x, ry - 1, z, lowPitchShop ? m.accent : m.wall);
        }
        if (e.roof === "clerestory" && z === e.z + Math.floor(e.d / 2) && x > e.x && x < e.x + e.w - 1) {
          fill(x, topY + 1, z, x, ry - 1, z, B.Glass);
        }
      }
    }
  }
}
