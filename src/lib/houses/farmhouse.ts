import { Block as B, type BlockId } from "@/lib/blocks";
import type { HousePrice } from "./catalog";
import type { Connection, Envelope, HousePlan, RoomUse, Volume } from "./plan";

/** Modern farmhouse compositions split into two distinct masses:
 * a single-story entry wing and a two-story opposite wing holding the stairs
 * and upper bedrooms, so the silhouette never reads as one giant rectangle. */
export function planFarmhouse(price: Exclude<HousePrice, "any">, random: () => number): HousePlan {
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const families = [
    "Split-story L-farmhouse",
    "Cross-gable farmhouse",
    "Stepped-porch farmhouse",
    "Offset-wing farmhouse",
  ] as const;
  const family = families[int(0, families.length - 1)]!;
  const entryOnLeft = random() < 0.5;
  const upscale = price === "upscale" || price === "luxury";

  const volumes: Volume[] = [];
  const envelopes: Envelope[] = [];
  const connections: Connection[] = [];

  const add = (x: number, z: number, w: number, d: number, use: RoomUse, stories: number) => {
    const v = { id: volumes.length, x, z, w, d, use, stories };
    volumes.push(v);
    return v;
  };
  const join = (a: Volume, b: Volume, x: number, z: number, side: boolean) =>
    connections.push({ a: a.id, b: b.id, x, z, side });

  // Single-story entry half (front edge at z = 0)
  const entryW = int(8, 10);
  const entryFrontD = int(7, 8);
  const entryRearD = int(7, 8);
  const entryD = entryFrontD + entryRearD - 1;

  // Two-story opposite half, stepped back from the entry front so the two halves articulate clearly
  const frontStep = family === "Cross-gable farmhouse" ? int(2, 3) : int(1, 3);
  const livingD = int(8, 10);
  const rearD = int(7, 9);
  const tallD = livingD + rearD - 1;

  // Keep the 2-story half wide enough for the stair-bearing living room (w >= 10)
  // plus two or three rear rooms depending on tier.
  const bed1W = int(6, 7);
  const bathW = int(5, 6);
  const bed2W = upscale ? int(6, 7) : 0;
  const tallW = upscale ? bed1W + bathW + bed2W - 2 : Math.max(11, bed1W + bathW - 1);

  const totalW = entryW + tallW - 1;
  const xStart = -Math.floor(totalW / 2);
  const xMid = entryOnLeft ? xStart + entryW - 1 : xStart + tallW - 1;
  const entryX = entryOnLeft ? xStart : xMid;
  const tallX = entryOnLeft ? xMid : xStart;

  // 1) Single-story entry half (volumes[0] is always the front entry room)
  const entryRoom = add(entryX, 1 - entryFrontD, entryW, entryFrontD, "Family room", 1);
  const kitchen = add(entryX, 1 - entryD, entryW, entryRearD, "Kitchen / dining", 1);
  join(entryRoom, kitchen, entryX + Math.floor(entryW / 2), entryRoom.z, false);

  const entryRidge: "x" | "z" =
    family === "Cross-gable farmhouse" || family === "Offset-wing farmhouse" ? "z" : "x";
  envelopes.push({
    x: entryX,
    z: 1 - entryD,
    w: entryW,
    d: entryD,
    stories: 1,
    rooms: [entryRoom.id, kitchen.id],
    roof: "gable",
    ridge: entryRidge,
  });

  // 2) Two-story opposite half (contains Living room with stairs + upper bedrooms/bath)
  const tallFrontZ = -frontStep;
  const livingZ = tallFrontZ - livingD + 1;
  const tallRearZ = livingZ - rearD + 1;

  let living: Volume;
  const tallRoomIds: number[] = [];

  if (upscale) {
    const livingW = int(10, 11);
    const studyW = tallW - livingW + 1;
    // Place Living room adjacent to xMid so you step from the 1-story entry right to the stairs
    if (entryOnLeft) {
      living = add(tallX, livingZ, livingW, livingD, "Living room", 2);
      const study = add(tallX + livingW - 1, livingZ, studyW, livingD, "Study", 2);
      join(living, study, study.x, livingZ + Math.floor(livingD / 2), true);
      tallRoomIds.push(living.id, study.id);
    } else {
      const study = add(tallX, livingZ, studyW, livingD, "Study", 2);
      living = add(tallX + studyW - 1, livingZ, livingW, livingD, "Living room", 2);
      join(study, living, living.x, livingZ + Math.floor(livingD / 2), true);
      tallRoomIds.push(study.id, living.id);
    }

    const bed1 = add(tallX, tallRearZ, bed1W, rearD, "Bedroom", 2);
    const bath = add(tallX + bed1W - 1, tallRearZ, bathW, rearD, "Bathroom", 2);
    const bed2 = add(bath.x + bathW - 1, tallRearZ, bed2W, rearD, "Bedroom", 2);
    tallRoomIds.push(bed1.id, bath.id, bed2.id);

    // Connect each rear room to whichever front 2-story room overlaps it most
    const frontTwo = volumes.filter((v) => tallRoomIds.includes(v.id) && v.z === livingZ);
    for (const rear of [bed1, bath, bed2]) {
      const host = frontTwo
        .map((f) => ({
          f,
          x1: Math.max(f.x, rear.x),
          x2: Math.min(f.x + f.w - 1, rear.x + rear.w - 1),
        }))
        .sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1))[0]!;
      join(host.f, rear, Math.floor((host.x1 + host.x2) / 2), livingZ, false);
    }
  } else {
    living = add(tallX, livingZ, tallW, livingD, "Living room", 2);
    const leftBedW = bed1W;
    const rightBathW = tallW - leftBedW + 1;
    const swapRear = random() < 0.5;
    const rearLeft = add(tallX, tallRearZ, swapRear ? rightBathW : leftBedW, rearD, swapRear ? "Bathroom" : "Bedroom", 2);
    const rearRight = add(tallX + (swapRear ? rightBathW : leftBedW) - 1, tallRearZ, swapRear ? leftBedW : rightBathW, rearD, swapRear ? "Bedroom" : "Bathroom", 2);
    join(living, rearLeft, rearLeft.x + Math.floor(rearLeft.w / 2), livingZ, false);
    join(living, rearRight, rearRight.x + Math.floor(rearRight.w / 2), livingZ, false);
    tallRoomIds.push(living.id, rearLeft.id, rearRight.id);
  }

  // Connect the 1-story entry room directly to the 2-story stair-bearing Living room
  const sharedZ1 = Math.max(entryRoom.z, living.z);
  const sharedZ2 = Math.min(entryRoom.z + entryRoom.d - 1, living.z + living.d - 1);
  const doorZ = Math.floor((sharedZ1 + sharedZ2) / 2);
  join(entryRoom, living, xMid, doorZ, true);

  const tallRidge: "x" | "z" =
    family === "Split-story L-farmhouse" || family === "Cross-gable farmhouse"
      ? entryRidge === "x"
        ? "z"
        : "x"
      : family === "Stepped-porch farmhouse"
        ? "x"
        : "z";

  envelopes.push({
    x: tallX,
    z: tallRearZ,
    w: tallW,
    d: tallD,
    stories: 2,
    rooms: tallRoomIds,
    roof: "gable",
    ridge: tallRidge,
  });

  const entryDoorX = entryX + Math.floor(entryW / 2);
  const entry = { x: entryDoorX, z: 0 };
  const signature = JSON.stringify(volumes.map(({ x, z, w, d, use, stories }) => [x, z, w, d, use, stories]));

  return {
    family,
    volumes,
    envelopes,
    connections,
    entry,
    signature,
    roofs: [],
    porchCanopy: true,
  };
}

/** Composed exterior detailing for split-story modern farmhouses so both
 * the red-brick and all-wood themes have clean windows, base trim, and entry framing. */
export function detailFarmhouse(
  plan: HousePlan,
  h: number,
  wall: BlockId,
  accent: BlockId,
  trim: BlockId,
  set: (x: number, y: number, z: number, b: BlockId | null) => unknown,
) {
  const occupied = (x: number, z: number, y: number) =>
    plan.envelopes.some((e) => x >= e.x && x < e.x + e.w && z >= e.z && z < e.z + e.d && y < e.stories * h);
  const exterior = (x: number, z: number, y: number) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => !occupied(x + dx, z + dz, y));

  // Clean exterior walls: North Idaho stone foundation base, crisp white board-and-batten siding,
  // warm cedar timber band between stories, and matte black corner trim.
  for (const e of plan.envelopes) {
    for (let x = e.x; x < e.x + e.w; x++) {
      for (let z = e.z; z < e.z + e.d; z++) {
        if (x !== e.x && x !== e.x + e.w - 1 && z !== e.z && z !== e.z + e.d - 1) continue;
        const corner = (x === e.x || x === e.x + e.w - 1) && (z === e.z || z === e.z + e.d - 1);
        for (let y = 0; y < e.stories * h; y++) {
          if (!exterior(x, z, y)) continue;
          if (y === 0) set(x, y, z, accent);
          else if (e.stories > 1 && y === h) set(x, y, z, B.StrippedSpruce);
          else if (corner) set(x, y, z, trim);
          else set(x, y, z, wall);
        }
      }
    }
  }

  // Tall black-framed farmhouse windows aligned to rooms on both 1st and 2nd stories
  for (const room of plan.volumes) {
    for (let story = 0; story < room.stories; story++) {
      const y = story * h;
      const bathroom = room.use === "Bathroom";
      // Front and back walls
      for (const z of [room.z, room.z + room.d - 1]) {
        const isEntryFace = room.id === 0 && story === 0 && z === plan.entry.z;
        const center = Math.floor(room.x + room.w / 2);
        if (isEntryFace) {
          // Flanking tall windows on either side of the cedar-framed front door
          for (const wx of [room.x + 2, room.x + room.w - 3]) {
            if (Math.abs(wx - plan.entry.x) >= 2 && exterior(wx, z, y + 2)) {
              set(wx, y + 1, z, trim);
              set(wx, y + 2, z, B.Glass);
              set(wx, y + 3, z, B.Glass);
            }
          }
          continue;
        }
        const half = bathroom ? 0 : 1;
        for (let x = center - half; x <= center + half; x++) {
          if (x <= room.x || x >= room.x + room.w - 1 || !exterior(x, z, y + 2)) continue;
          set(x, y + 2, z, B.Glass);
          if (!bathroom) {
            set(x, y + 3, z, B.Glass);
            set(x, y + 1, z, trim);
          }
        }
      }
      // Side walls
      for (const x of [room.x, room.x + room.w - 1]) {
        const cz = Math.floor(room.z + room.d / 2);
        for (let dz = -1; dz <= 1; dz++) {
          const z = cz + dz;
          if (z <= room.z || z >= room.z + room.d - 1 || !exterior(x, z, y + 2)) continue;
          set(x, y + 2, z, B.Glass);
          if (!bathroom) {
            set(x, y + 3, z, B.Glass);
            set(x, y + 1, z, trim);
          }
        }
      }
    }
  }

  // Warm cedar timber entry surround with matte black sill accents
  set(plan.entry.x - 1, 1, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x + 1, 1, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x - 1, 2, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x + 1, 2, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x - 1, 3, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x, 3, plan.entry.z, B.StrippedSpruce);
  set(plan.entry.x + 1, 3, plan.entry.z, B.StrippedSpruce);
}
