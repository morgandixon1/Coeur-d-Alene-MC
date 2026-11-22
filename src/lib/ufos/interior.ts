import { Block as B, type BlockId } from "@/lib/blocks";
import type { UfoCivilization } from "./catalog";

type Feature = "command" | "power" | "quarters" | "cargo" | "clinic" | "lab" | "mess" | "growth" | "vault";
type ShipCivilization = Exclude<UfoCivilization, "blight">;
type RoomUse = readonly [name: string, feature: Feature];
type Bounds = { x0: number; x1: number; z0: number; z1: number };
type Room = Bounds & { use: RoomUse; door: { x: number; z: number }; side?: -1 | 1 };
type DeckPlan = { name: string; y: number; rooms: Room[] };

const PROGRAM = {
  classic: {
    main: [["Crew quarters", "quarters"], ["Engineering", "power"], ["Cargo bay", "cargo"], ["Medbay", "clinic"], ["Galley", "mess"], ["Workshop", "lab"]],
    upper: [["Research lab", "lab"], ["Hydroponics", "growth"], ["Data vault", "vault"], ["Briefing room", "mess"], ["Communications", "command"], ["Auxiliary reactor", "power"]],
    bow: [["Flight bridge", "command"], ["Observation lounge", "mess"]],
    aft: [["Salvage locker", "vault"], ["Escape pod bay", "cargo"]],
  },
  xenos: {
    main: [["Brood dormitory", "quarters"], ["Digestive chamber", "power"], ["Husk storage", "cargo"], ["Recovery nest", "clinic"], ["Feeding hall", "mess"], ["Carapace workshop", "lab"]],
    upper: [["Spore garden", "growth"], ["Brood nursery", "growth"], ["Relic vault", "vault"], ["Synapse lab", "lab"], ["Sensory chamber", "command"], ["Molting chamber", "clinic"]],
    bow: [["Synapse chamber", "command"], ["Pulse heart", "power"]],
    aft: [["Husk vault", "vault"], ["Latching chamber", "cargo"]],
  },
} as const satisfies Record<ShipCivilization, { main: readonly RoomUse[]; upper: readonly RoomUse[]; bow: readonly RoomUse[]; aft: readonly RoomUse[] }>;

export function buildInterior(
  civilization: ShipCivilization,
  rz: number,
  trim: BlockId,
  within: (x: number, z: number, radius: number) => boolean,
  set: (x: number, y: number, z: number, block: BlockId) => void,
  clear: (x: number, y: number, z: number) => void,
  random: () => number,
) {
  const xenos = civilization === "xenos";
  const bulkhead = xenos ? B.Basalt : B.Iron;
  const panel = xenos ? B.Obsidian : B.GrayConcrete;
  const passage = xenos ? B.RedTerracotta : B.LightGrayConcrete;
  const lamp = xenos ? B.Shroomlight : B.SeaLantern;
  const window = xenos ? B.CryingObsidian : B.Glass;
  const program = PROGRAM[civilization];
  const integer = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const stairStart = integer(-1, 6);

  const decks: DeckPlan[] = [0, 1].map((index) => {
    const upper = index === 1;
    const y = index * 5;
    const start = upper ? -10 : -13;
    const end = upper ? 12 : 16;
    const radius = upper ? 0.63 : 0.70;
    const widthAt = (side: number, z0: number, z1: number, limit = radius) => {
      let edge = 7;
      while (edge < 18 && within(side * (edge + 1), z0, limit) && within(side * (edge + 1), z1, limit)) edge++;
      return edge;
    };

    const roles: RoomUse[] = [...(upper ? program.upper : program.main)];
    const rooms: Room[] = [];
    const bowZ = start - 5;
    rooms.push({
      x0: -widthAt(-1, bowZ, start), x1: widthAt(1, bowZ, start), z0: bowZ, z1: start,
      use: program.bow[index], door: { x: 0, z: start },
    });

    // Each flank can have two large rooms or three smaller ones, with independent bulkhead positions.
    for (const side of [-1, 1] as const) {
      const split = integer(0, 1) === 0
        ? [start, integer(-2, 3), end]
        : [start, start + integer(6, 8), end - integer(6, 8), end];
      for (let i = 1; i < split.length; i++) {
        const z0 = split[i - 1];
        const z1 = split[i];
        const depth = widthAt(side, z0, z1) - integer(0, 1);
        const [use] = roles.splice(integer(0, roles.length - 1), 1);
        rooms.push({
          x0: side < 0 ? -depth : 3, x1: side < 0 ? -3 : depth, z0, z1, use, side,
          door: { x: side * 3, z: integer(z0 + 2, z1 - 2) },
        });
      }
    }

    if (!upper) {
      const swap = integer(0, 1);
      for (const side of [-1, 1] as const) {
        const z1 = end + integer(5, 7);
        const depth = widthAt(side, end, z1, 0.77);
        rooms.push({
          x0: side < 0 ? -depth : 3, x1: side < 0 ? -3 : depth, z0: end, z1, side,
          use: program.aft[side < 0 ? swap : 1 - swap], door: { x: side * 3, z: end + 2 },
        });
      }
    }

    for (let z = start + 1; z <= (upper ? end : rz); z++) {
      for (let x = -2; x <= 2; x++) {
        if (Math.abs(x) > 1 && z >= rz - 1) continue;
        set(x, y, z, x === 0 && z % 5 === 0 ? lamp : passage);
        for (let h = 1; h <= 3; h++) clear(x, y + h, z);
      }
    }
    if (upper) {
      for (let x = -2; x <= 2; x++) for (let h = 1; h <= 3; h++) set(x, y + h, end, bulkhead);
    } else {
      // A framed airlock marks the transition from the aft approach into the occupied decks.
      for (const z of [end + 8, end + 11]) {
        for (const x of [-2, 2]) for (let h = 1; h <= 3; h++) set(x, h, z, h === 2 ? lamp : trim);
        for (let x = -2; x <= 2; x++) set(x, 4, z, bulkhead);
      }
    }

    for (const room of rooms) {
      const { x0, x1, z0, z1, door, use, side } = room;
      const [, feature] = use;
      const floor = feature === "power" || feature === "vault"
        ? (xenos ? B.RedTerracotta : B.GrayConcrete)
        : feature === "growth" ? (xenos ? B.BrownTerracotta : B.GreenTerracotta)
        : feature === "clinic" || feature === "lab" ? (xenos ? B.PurpleConcrete : B.LightGrayConcrete)
        : xenos ? B.BlackConcrete : B.GrayConcrete;
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const edge = x === x0 || x === x1 || z === z0 || z === z1;
          const doorway = door.x === x && (side ? z >= door.z && z <= door.z + 1 : z === door.z);
          const wideBowDoor = !side && z === door.z && Math.abs(x) <= 1;
          const inlay = !edge && (x === x0 + 1 || x === x1 - 1 || z === z0 + 1 || z === z1 - 1);
          set(x, y, z, edge ? trim : inlay ? passage : floor);
          set(x, y + 4, z, !edge && (x - x0) % 4 === 2 && (z - z0) % 4 === 2 ? lamp : bulkhead);
          for (let h = 1; h <= 3; h++) {
            if (!edge || doorway || wideBowDoor) clear(x, y + h, z);
            else set(x, y + h, z, h === 2 && (x + z) % 4 !== 0 ? window : bulkhead);
          }
          if (doorway || wideBowDoor) {
            set(x, y, z, lamp);
            set(x, y + 3, z, trim);
          }
        }
      }

      // Fixtures sit along the outside wall. The middle of each room stays clear from its door.
      const face = side === -1 ? x0 + 1 : x1 - 1;
      const put = (x: number, h: number, z: number, block: BlockId) => set(x, y + h, z, block);
      if (!side || feature === "command") {
        for (let x = x0 + 2; x <= x1 - 2; x++) {
          put(x, 1, z0 + 1, trim);
          if (x % 3 === 0) put(x, 2, z0 + 1, lamp);
        }
        if (feature === "power") for (const x of [-3, 3]) put(x, 3, z0 + 1, window);
      } else {
        for (let z = z0 + 1; z < z1; z++) {
          if (feature === "cargo" || feature === "vault") {
            if ((z - z0) % 3 === 0) continue;
            put(face, 1, z, trim);
            if ((z - z0) % 2 === 0) put(face, 2, z, xenos ? B.Obsidian : B.Iron);
          } else if (feature === "quarters" || feature === "clinic") {
            if ((z - z0) % 3 === 0) continue;
            put(face, 1, z, xenos ? B.RedWool : B.WhiteWool);
            if (feature === "quarters") put(face, 3, z, xenos ? B.RedWool : B.WhiteWool);
          } else if (feature === "growth" || feature === "power") {
            put(face, 1, z, feature === "growth" ? (xenos ? B.RedTerracotta : B.Moss) : panel);
            if ((z - z0) % 2 === 0) {
              put(face, 2, z, lamp);
              put(face, 3, z, window);
            }
          } else {
            put(face, 1, z, feature === "lab" ? (xenos ? B.Quartz : B.CraftingTable) : trim);
            if ((z - z0) % 3 === 1) put(face, 2, z, lamp);
          }
        }
        if (x1 - x0 >= 7 && z1 - z0 >= 5) {
          const island = Math.round((x0 + x1) / 2);
          for (let z = z0 + 2; z <= z1 - 2; z += 4) {
            switch (feature) {
              case "growth":
              case "power":
                put(island, 1, z, feature === "growth" ? (xenos ? B.RedTerracotta : B.Moss) : trim);
                put(island, 2, z, lamp);
                put(island, 3, z, window);
                if (feature === "growth") put(island, 1, z + 1, xenos ? B.Basalt : B.Moss);
                break;
              case "mess":
              case "lab":
                put(island, 1, z, xenos ? B.Quartz : B.LightGrayConcrete);
                put(island, 1, z + 1, xenos ? B.Quartz : B.LightGrayConcrete);
                put(island + side, 1, z, trim);
                if (feature === "lab") put(island, 2, z, window);
                break;
              case "clinic":
              case "quarters":
                put(island, 1, z, xenos ? B.RedWool : B.WhiteWool);
                put(island, 1, z + 1, xenos ? B.RedWool : B.WhiteWool);
                put(island + side, 1, z, lamp);
                break;
              case "cargo":
              case "vault":
                put(island, 1, z, trim);
                put(island, 2, z, panel);
                put(island + side, 1, z + 1, panel);
                break;
            }
          }
        }
      }


    }

    // Link adjacent rooms on one flank to make a second route off the main passage.
    const linkedSide = integer(0, 1) === 0 ? -1 : 1;
    const adjacent = rooms.filter((room) => room.side === linkedSide);
    for (const room of adjacent.slice(0, -1)) {
      const x = linkedSide * 5;
      set(x, y, room.z1, lamp);
      clear(x, y + 1, room.z1);
      clear(x, y + 2, room.z1);
      set(x, y + 3, room.z1, trim);
    }
    return { name: upper ? "Upper deck" : "Main deck", y, rooms };
  });

  // The walkable steps finish flush with the upper floor and have two clear blocks overhead.
  for (let x = -1; x <= 0; x++) {
    for (let step = 1; step <= 5; step++) {
      const z = stairStart - step + 1;
      set(x, step, z, step === 5 ? lamp : trim);
      for (let h = 1; h <= Math.max(3, 5 - step); h++) clear(x, step + h, z);
    }
  }
  return decks;
}
