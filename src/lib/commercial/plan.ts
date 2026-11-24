import type { CommercialScale, CommercialType } from "./catalog";

export type CommercialRoomUse =
  | "Lobby"
  | "Retail floor"
  | "Dining room"
  | "Commercial kitchen"
  | "Office suite"
  | "Conference room"
  | "Stockroom"
  | "Warehouse bay"
  | "Service bay"
  | "Restroom"
  | "Break room"
  | "Changing rooms"
  | "Guest suite";

export type CommercialVolume = {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  use: CommercialRoomUse;
  stories: number;
};

export type RoofStyle = "parapet" | "gable" | "shed" | "hip" | "clerestory";

export type CommercialEnvelope = {
  x: number;
  z: number;
  w: number;
  d: number;
  stories: number;
  rooms: number[];
  roof: RoofStyle;
  ridge: "x" | "z";
};

export type CommercialConnection = {
  a: number;
  b: number;
  x: number;
  z: number;
  side: boolean;
};

export type BayDoor = {
  x: number;
  z: number;
  width: number;
  height: number;
  side: boolean;
  dx: number;
  dz: number;
};

export type PatioZone = {
  x: number;
  z: number;
  w: number;
  d: number;
  covered: boolean;
};

export type IndustrialStyle = "contractor_shop" | "showroom_warehouse" | "tiltup_distribution";

export type CommercialPlan = {
  family: string;
  industrialStyle?: IndustrialStyle;
  storyHeight: number;
  volumes: CommercialVolume[];
  envelopes: CommercialEnvelope[];
  connections: CommercialConnection[];
  entries: { x: number; z: number }[];
  bayDoors: BayDoor[];
  patio?: PatioZone;
  awningDepth: number;
  hasParking: boolean;
  hasRooftopHvac: boolean;
  signature: string;
};

type ResolvedType = Exclude<CommercialType, "any">;
type ResolvedScale = Exclude<CommercialScale, "any">;

function connectVolumes(volumes: CommercialVolume[], random: () => number): CommercialConnection[] {
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const edges: (CommercialConnection & { score: number })[] = [];

  for (const a of volumes) {
    for (const b of volumes) {
      if (a.id >= b.id) continue;
      const x1 = Math.max(a.x, b.x);
      const x2 = Math.min(a.x + a.w - 1, b.x + b.w - 1);
      const z1 = Math.max(a.z, b.z);
      const z2 = Math.min(a.z + a.d - 1, b.z + b.d - 1);
      const side = x1 === x2 && z2 - z1 >= 3;
      const frontBack = z1 === z2 && x2 - x1 >= 3;
      if (!side && !frontBack) continue;

      const x = side ? x1 : int(x1 + 1, x2 - 1);
      const z = side ? int(z1 + 1, z2 - 1) : z1;
      const uses = [a.use, b.use];
      const penalty =
        (uses.includes("Restroom") ? 12 : 0) +
        (uses.includes("Stockroom") ? 4 : 0) +
        (uses.includes("Commercial kitchen") ? 3 : 0);

      edges.push({ a: a.id, b: b.id, x, z, side, score: random() + penalty });
    }
  }

  const parent = volumes.map((v) => v.id);
  const find = (id: number): number => (parent[id] === id ? id : (parent[id] = find(parent[id])));
  const connections: CommercialConnection[] = [];

  for (const edge of edges.sort((a, b) => a.score - b.score)) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra === rb) continue;
    parent[rb] = ra;
    connections.push({ a: edge.a, b: edge.b, x: edge.x, z: edge.z, side: edge.side });
  }

  if (connections.length !== volumes.length - 1) {
    throw new Error("Disconnected commercial building plan");
  }
  return connections;
}

export function planCommercial(
  type: ResolvedType,
  scale: ResolvedScale,
  random: () => number,
): CommercialPlan {
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  const rank = (["small", "medium", "large"] as const).indexOf(scale);

  const volumes: CommercialVolume[] = [];
  const envelopes: CommercialEnvelope[] = [];
  const entries: { x: number; z: number }[] = [];
  const bayDoors: BayDoor[] = [];
  let patio: PatioZone | undefined;
  let family = "";
  let industrialStyle: IndustrialStyle | undefined;
  let storyHeight = 5;
  let awningDepth = 0;
  let hasParking = false;
  let hasRooftopHvac = true;

  const add = (
    x: number,
    z: number,
    w: number,
    d: number,
    use: CommercialRoomUse,
    stories: number,
  ) => {
    const v: CommercialVolume = { id: volumes.length, x, z, w, d, use, stories };
    volumes.push(v);
    return v;
  };

  if (type === "sherman_storefront") {
    storyHeight = 5;
    awningDepth = 2;
    hasParking = false;
    hasRooftopHvac = true;
    const stories = rank === 0 ? (random() < 0.5 ? 1 : 2) : rank === 1 ? 2 : pick([2, 3]);
    const w = rank === 0 ? int(11, 13) : rank === 1 ? int(14, 17) : int(18, 22);
    const frontD = int(9, 11);
    const rearD = int(6, 8);
    const totalD = frontD + rearD - 1;
    const x0 = -Math.floor(w / 2);
    const z0 = 1 - totalD;

    const frontRoom = add(x0, 1 - frontD, w, frontD, "Retail floor", stories);
    const split = Math.max(5, Math.floor(w * 0.58));
    const stockW = split;
    const officeW = w - split + 1;
    const rearLeft = add(x0, z0, stockW, rearD, "Stockroom", stories);
    const rearRight = add(x0 + split - 1, z0, officeW, rearD, officeW >= 7 ? "Office suite" : "Restroom", stories);
    const mainRooms = [frontRoom.id, rearLeft.id, rearRight.id];

    envelopes.push({
      x: x0,
      z: z0,
      w,
      d: totalD,
      stories,
      rooms: mainRooms,
      roof: "parapet",
      ridge: "x",
    });

    if (rank === 2 && random() < 0.55) {
      // Corner annex wing
      const wingW = int(8, 10);
      const wingD = frontD;
      const left = random() < 0.5;
      const wx = left ? x0 - wingW + 1 : x0 + w - 1;
      const wing = add(wx, 1 - wingD, wingW, wingD, "Retail floor", Math.max(1, stories - 1));
      envelopes.push({
        x: wx,
        z: 1 - wingD,
        w: wingW,
        d: wingD,
        stories: wing.stories,
        rooms: [wing.id],
        roof: "parapet",
        ridge: "x",
      });
      entries.push({ x: Math.floor(wing.x + wing.w / 2), z: 0 });
      family = "Corner block storefront";
    } else {
      family = stories === 1 ? "Single-story retail block" : stories === 2 ? "Two-story Main St block" : "Three-story brick block";
    }
    entries.unshift({ x: Math.floor(frontRoom.x + frontRoom.w / 2), z: 0 });
  } else if (type === "strip_plaza") {
    storyHeight = 5;
    awningDepth = 2;
    hasParking = true;
    hasRooftopHvac = true;
    const bayCount = rank === 2 ? int(3, 4) : int(2, 3);
    const bayW = int(9, 11);
    const frontD = int(8, 10);
    const backD = 6;
    const totalW = bayCount * bayW - (bayCount - 1);
    const totalD = frontD + backD - 1;
    const x0 = -Math.floor(totalW / 2);
    const z0 = 1 - totalD;

    const tenantUses: CommercialRoomUse[] = ["Retail floor", "Dining room", "Office suite", "Retail floor"];
    const roomIds: number[] = [];
    for (let i = 0; i < bayCount; i++) {
      const bx = x0 + i * (bayW - 1);
      const use = tenantUses[i % tenantUses.length]!;
      const front = add(bx, 1 - frontD, bayW, frontD, use, 1);
      const backUse: CommercialRoomUse = use === "Dining room" ? "Commercial kitchen" : i === bayCount - 1 ? "Restroom" : "Stockroom";
      const back = add(bx, z0, bayW, backD, backUse, 1);
      roomIds.push(front.id, back.id);
      entries.push({ x: Math.floor(bx + bayW / 2), z: 0 });
    }

    envelopes.push({
      x: x0,
      z: z0,
      w: totalW,
      d: totalD,
      stories: 1,
      rooms: roomIds,
      roof: "parapet",
      ridge: "x",
    });
    family = `${bayCount}-bay retail plaza`;
  } else if (type === "cafe_diner") {
    storyHeight = 5;
    awningDepth = 2;
    hasParking = true;
    hasRooftopHvac = false;
    const w = rank === 0 ? int(12, 14) : int(15, 19);
    const frontD = int(8, 10);
    const rearD = int(6, 7);
    const totalD = frontD + rearD - 1;
    const x0 = -Math.floor(w / 2);
    const z0 = 1 - totalD;

    const dining = add(x0, 1 - frontD, w, frontD, "Dining room", 1);
    const kitW = Math.max(6, Math.floor(w * 0.62));
    const restW = w - kitW + 1;
    const kitchen = add(x0, z0, kitW, rearD, "Commercial kitchen", 1);
    const restroom = add(x0 + kitW - 1, z0, restW, rearD, "Restroom", 1);

    const roof: RoofStyle = pick(["gable", "shed", "parapet"]);
    envelopes.push({
      x: x0,
      z: z0,
      w,
      d: totalD,
      stories: 1,
      rooms: [dining.id, kitchen.id, restroom.id],
      roof,
      ridge: "x",
    });

    // Side or front covered patio
    const sidePatio = random() < 0.55;
    if (sidePatio) {
      const pw = int(5, 7);
      patio = { x: x0 + w, z: 1 - frontD + 1, w: pw, d: frontD - 1, covered: true };
      family = roof === "shed" ? "Modern roastery with patio" : "Side-patio coffeehouse";
    } else {
      patio = { x: x0 + 1, z: 1, w: w - 2, d: 4, covered: true };
      family = roof === "parapet" ? "Highway 95 diner" : "Covered-porch cafe";
    }
    entries.push({ x: Math.floor(dining.x + dining.w / 2), z: 0 });
  } else if (type === "office_midrise") {
    storyHeight = 5;
    awningDepth = 2;
    hasParking = true;
    hasRooftopHvac = true;
    const stories = rank === 1 ? 2 : pick([3, 4]);
    const col1 = int(9, 11);
    const col2 = int(9, 11);
    const w = col1 + col2 - 1;
    const frontD = int(8, 10);
    const rearD = int(7, 9);
    const totalD = frontD + rearD - 1;
    const x0 = -Math.floor(w / 2);
    const z0 = 1 - totalD;

    const lobby = add(x0, 1 - frontD, col1, frontD, "Lobby", stories);
    const conf = add(x0 + col1 - 1, 1 - frontD, col2, frontD, "Conference room", stories);
    const office = add(x0, z0, col1, rearD, "Office suite", stories);
    const rearRight = add(x0 + col1 - 1, z0, col2, rearD, "Break room", stories);

    envelopes.push({
      x: x0,
      z: z0,
      w,
      d: totalD,
      stories,
      rooms: [lobby.id, conf.id, office.id, rearRight.id],
      roof: "parapet",
      ridge: "x",
    });

    if (rank === 2 && random() < 0.6) {
      const wingW = int(8, 10);
      const wingD = int(9, 11);
      const wx = x0 + w - 1;
      const wz = 1 - wingD;
      const wing = add(wx, wz, wingW, wingD, "Office suite", Math.max(2, stories - 1));
      envelopes.push({
        x: wx,
        z: wz,
        w: wingW,
        d: wingD,
        stories: wing.stories,
        rooms: [wing.id],
        roof: "parapet",
        ridge: "z",
      });
      family = `${stories}-story stepped office`;
    } else {
      family = `${stories}-story professional building`;
    }
    entries.push({ x: Math.floor(lobby.x + lobby.w / 2), z: 0 });
  } else if (type === "warehouse") {
    // Three authentic Coeur d'Alene / North Idaho industrial archetypes:
    // 1. Contractor flex shop (gable-front with bay hood + side office hood)
    // 2. Showroom warehouse (wide overhanging fascia + peaked entry accent + sign plaques)
    // 3. Tilt-up concrete distribution (flush long box, truck bay + yellow bollards, 2-tier office corner)
    industrialStyle =
      rank === 0
        ? "contractor_shop"
        : rank === 1
          ? pick(["contractor_shop", "showroom_warehouse", "tiltup_distribution"] as const)
          : pick(["showroom_warehouse", "tiltup_distribution"] as const);

    hasParking = true;

    if (industrialStyle === "contractor_shop") {
      // Photo 1: Deeper-than-wide gable-front contractor flex shop
      storyHeight = 6;
      awningDepth = 0;
      hasRooftopHvac = false;
      const mainW = rank === 0 ? int(15, 17) : int(17, 19);
      const mainD = rank === 0 ? int(18, 20) : int(20, 23);
      const x0 = -Math.floor(mainW / 2);
      const z0 = 1 - mainD;
      const offW = 6;
      const offD = 7;
      const bayW = mainW - offW + 1;

      const bay = add(x0, z0, bayW, mainD, "Warehouse bay", 1);
      const office = add(x0 + bayW - 1, 1 - offD, offW, offD, "Office suite", 1);
      const backStock = add(x0 + bayW - 1, z0, offW, mainD - offD + 1, "Stockroom", 1);

      envelopes.push({
        x: x0,
        z: z0,
        w: mainW,
        d: mainD,
        stories: 1,
        rooms: [bay.id, office.id, backStock.id],
        roof: "gable",
        ridge: "z",
      });

      entries.push({ x: office.x + 2, z: 0 });
      bayDoors.push({
        x: Math.floor(bay.x + bay.w / 2),
        z: 0,
        width: 4,
        height: 5,
        side: false,
        dx: 0,
        dz: 1,
      });
      family = "Contractor flex shop";
    } else if (industrialStyle === "showroom_warehouse") {
      // Photo 2: Very wide, low-slung showroom warehouse with deep overhanging fascia & peaked entry gable
      storyHeight = 5;
      awningDepth = 0;
      hasRooftopHvac = true;
      const mainW = rank === 2 ? int(32, 36) : int(28, 32);
      const frontD = int(8, 9);
      const rearD = int(7, 8);
      const mainD = frontD + rearD - 1;
      const x0 = -Math.floor(mainW / 2);
      const z0 = 1 - mainD;

      const showroom = add(x0, 1 - frontD, mainW, frontD, "Retail floor", 1);
      const warehouse = add(x0, z0, mainW, rearD, "Warehouse bay", 1);

      envelopes.push({
        x: x0,
        z: z0,
        w: mainW,
        d: mainD,
        stories: 1,
        rooms: [showroom.id, warehouse.id],
        roof: "parapet",
        ridge: "x",
      });

      entries.push({ x: x0 + Math.floor(mainW * 0.28), z: 0 });
      bayDoors.push({
        x: x0 + mainW - 1,
        z: Math.floor(z0 + rearD / 2),
        width: 4,
        height: 4,
        side: true,
        dx: 1,
        dz: 0,
      });
      family = "Showroom warehouse";
    } else {
      // Photo 3: Long, sleek horizontal tilt-up concrete distribution warehouse (width ~2.5x depth)
      storyHeight = 7;
      awningDepth = 0;
      hasRooftopHvac = true;
      const mainW = rank === 2 ? int(34, 38) : int(30, 34);
      const mainD = rank === 2 ? int(14, 16) : int(13, 15);
      const x0 = -Math.floor(mainW / 2);
      const z0 = 1 - mainD;
      const offW = 10;
      const bayW = mainW - offW + 1;
      const offFrontD = Math.floor(mainD / 2) + 1;
      const offRearD = mainD - offFrontD + 1;

      const bay = add(x0, z0, bayW, mainD, "Warehouse bay", 1);
      const office = add(x0 + bayW - 1, 1 - offFrontD, offW, offFrontD, "Office suite", 1);
      const breakRoom = add(x0 + bayW - 1, z0, offW, offRearD, "Break room", 1);

      envelopes.push({
        x: x0,
        z: z0,
        w: mainW,
        d: mainD,
        stories: 1,
        rooms: [bay.id, office.id, breakRoom.id],
        roof: "parapet",
        ridge: "x",
      });

      entries.push({ x: office.x + 2, z: 0 });
      bayDoors.push({
        x: x0 + Math.floor(bayW * 0.56),
        z: 0,
        width: 5,
        height: 5,
        side: false,
        dx: 0,
        dz: 1,
      });
      family = "Tilt-up distribution warehouse";
    }
  } else if (type === "auto_shop") {
    storyHeight = 6;
    awningDepth = 1;
    hasParking = true;
    hasRooftopHvac = true;
    const numBays = rank === 0 ? 2 : 3;
    const baySpan = 6;
    const shopW = numBays * baySpan + 2;
    const shopD = int(10, 12);
    const offW = int(8, 9);
    const offD = int(8, 9);
    const totalW = offW + shopW - 1;
    const x0 = -Math.floor(totalW / 2);

    const lobby = add(x0, 1 - offD, offW, offD, "Lobby", 1);
    const service = add(x0 + offW - 1, 1 - shopD, shopW, shopD, "Service bay", 1);
    const parts = add(x0, 1 - shopD, offW, shopD - offD + 1 >= 5 ? shopD - offD + 1 : 5, "Stockroom", 1);
    // Align parts room directly behind lobby
    parts.z = lobby.z - parts.d + 1;

    envelopes.push({
      x: x0 + offW - 1,
      z: 1 - shopD,
      w: shopW,
      d: shopD,
      stories: 1,
      rooms: [service.id],
      roof: "parapet",
      ridge: "x",
    });
    envelopes.push({
      x: x0,
      z: parts.z,
      w: offW,
      d: lobby.z + lobby.d - parts.z,
      stories: 1,
      rooms: [lobby.id, parts.id],
      roof: "parapet",
      ridge: "x",
    });

    entries.push({ x: Math.floor(lobby.x + lobby.w / 2), z: 0 });
    for (let i = 0; i < numBays; i++) {
      const bx = service.x + 3 + i * baySpan;
      bayDoors.push({ x: bx, z: 0, width: 4, height: 4, side: false, dx: 0, dz: 1 });
    }
    family = `${numBays}-bay auto & marine shop`;
  } else {
    // lakefront_lodge: Timber & stone hospitality / brewery / boutique hotel
    storyHeight = 5;
    awningDepth = 0;
    hasParking = true;
    hasRooftopHvac = false;
    const stories = rank === 2 ? 3 : 2;
    const w = rank === 2 ? int(20, 24) : int(16, 19);
    const frontD = int(9, 11);
    const rearD = int(7, 9);
    const totalD = frontD + rearD - 1;
    const x0 = -Math.floor(w / 2);
    const z0 = 1 - totalD;

    const col1 = Math.floor(w / 2) + 1;
    const col2 = w - col1 + 1;
    const lobby = add(x0, 1 - frontD, col1, frontD, "Lobby", stories);
    const dining = add(x0 + col1 - 1, 1 - frontD, col2, frontD, "Dining room", stories);
    const kitchen = add(x0 + col1 - 1, z0, col2, rearD, "Commercial kitchen", stories);
    const backSuite = add(x0, z0, col1, rearD, "Guest suite", stories);

    envelopes.push({
      x: x0,
      z: z0,
      w,
      d: totalD,
      stories,
      rooms: [lobby.id, dining.id, kitchen.id, backSuite.id],
      roof: pick(["gable", "hip"]),
      ridge: "x",
    });

    patio = { x: x0 + 1, z: 1, w: w - 2, d: 4, covered: true };
    entries.push({ x: Math.floor(lobby.x + lobby.w / 2), z: 0 });
    family = stories === 3 ? "Timber lakefront hotel" : "North Idaho brewery lodge";
  }

  const connections = connectVolumes(volumes, random);
  const signature = JSON.stringify(volumes.map(({ x, z, w, d, use, stories }) => [x, z, w, d, use, stories]));

  return {
    family,
    industrialStyle,
    storyHeight,
    volumes,
    envelopes,
    connections,
    entries,
    bayDoors,
    patio,
    awningDepth,
    hasParking,
    hasRooftopHvac,
    signature,
  };
}
