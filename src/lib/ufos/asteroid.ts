import { Block as B, type BlockId } from "@/lib/blocks";
import { seededRandom } from "@/lib/seeded-random";
import type { Voxel } from "@/lib/voxels";
import { conditionLabel, UFO_HULLS, type AsteroidHull, type UfoCondition } from "./catalog";
import { planAsteroidCaves, type Point } from "./asteroid-caves";
import { addSalvage } from "./salvage";
import { addAsteroidOre } from "./asteroid-ore";
import { asteroidGeology } from "./asteroid-geology";
import { columnKey, voxelKey, type Ufo, type UfoRoom } from "./scene";

const PROFILES = {
  seedstone: { width: 23, length: 26, height: 22, lobes: 1 },
  splitGeode: { width: 26, length: 24, height: 23, lobes: 2 },
  hiveCluster: { width: 25, length: 26, height: 24, lobes: 3 },
} as const;

type Passage = Point & { y: number; clearance: number; rib?: boolean };
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SIDES = NEIGHBORS.filter(([dx, , dz]) => dx || dz);
const MEMBRANE = [B.Obsidian, B.CryingObsidian, B.Moss] as const;

export function generateAsteroid(hull: AsteroidHull, condition: UfoCondition, seed: number): Ufo {
  const random = seededRandom(seed ^ 0xca752185);
  const integer = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const profile = PROFILES[hull];
  const rx = profile.width + integer(0, 4);
  const rz = profile.length + integer(0, 4);
  const outerY = condition === "impact" ? -1 : 2;
  const radialPhase = random() * Math.PI * 2;
  const shattered = condition === "exploded";
  const spawn = { x: 0, y: 0, z: rz + 22 };
  const caveWidth = condition === "skid" ? Math.floor(rx * 0.86) : rx;
  const { decks, connectors } = planAsteroidCaves(caveWidth, rz, outerY, hull, seededRandom(seed ^ 0x84c96399));

  const blocks = new Map<string, Voxel>();
  const rock = new Map<string, Voxel>();
  const ground = new Map<string, number>();
  const floors = new Map<string, Passage>();
  const ledgeFloors = new Set<string>();
  const air = new Set<string>();
  const put = (x: number, y: number, z: number, block: BlockId) => blocks.set(voxelKey(x, y, z), { x, y, z, block });
  const noise = (x: number, y: number, z: number) => {
    const n = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ seed;
    return ((n ^ n >>> 13 ^ Math.imul(n, 1274126177)) >>> 0) / 0x100000000;
  };

  const geology = asteroidGeology({ hull, condition, rx, rz, height: profile.height, lobes: profile.lobes, phase: radialPhase, outerY }, noise);

  const mark = (x: number, y: number, z: number, clearance: number, rib = false) => {
    const key = voxelKey(x, y, z);
    const previous = floors.get(key);
    if (!previous || previous.clearance < clearance) floors.set(key, { x, y, z, clearance, rib });
  };

  function tunnel(points: Point[], startY: number, endY = startY, radius = 1, bareRock = false) {
    const add = (x: number, y: number, z: number, rib = false) => {
      mark(x, y, z, 3, rib && !bareRock);
      if (bareRock) ledgeFloors.add(voxelKey(x, y, z));
    };
    let distance = 0;
    const length = points.slice(1).reduce((sum, point, i) =>
      sum + Math.abs(point.x - points[i].x) + Math.abs(point.z - points[i].z), 0);
    let { x, z } = points[0];
    for (const next of points.slice(1)) {
      const dx = Math.abs(next.x - x);
      const dz = Math.abs(next.z - z);
      const sx = Math.sign(next.x - x);
      const sz = Math.sign(next.z - z);
      let ix = 0;
      let iz = 0;
      while (ix < dx || iz < dz) {
        const y = Math.round(startY + (endY - startY) * distance / length);
        const alongX = iz === dz || (ix < dx && (ix + 0.5) * dz < (iz + 0.5) * dx);
        // Widen perpendicular to travel. The center keeps its stair height on slopes.
        for (let offset = -radius; offset <= radius; offset++) {
          add(x + (alongX ? 0 : offset), y, z + (alongX ? offset : 0), distance % 5 === 0);
        }
        if (alongX) { x += sx; ix++; }
        else { z += sz; iz++; }
        distance++;
      }
    }
    add(x, endY, z);
  }

  for (const { y, rooms, routes } of decks) {
    for (const room of rooms) {
      for (let dx = -room.rx; dx <= room.rx; dx++) for (let dz = -room.rz; dz <= room.rz; dz++) {
        const edge = (dx / room.rx) ** 2 + (dz / room.rz) ** 2;
        if (edge > 1) continue;
        const height = Math.max(3, room.clearance - Math.floor(edge * 2 + noise(dx, y, dz)));
        mark(room.x + dx, y, room.z + dz, height);
      }
    }
    for (const [i, route] of routes.entries()) tunnel(route, y, y, i % 3 === 0 ? 1 : 0);
  }
  for (const { top, bottom, start, end, upper, lower } of connectors) {
    tunnel(upper, top.y, top.y, 0);
    tunnel([start, end], top.y, bottom.y, 0);
    tunnel(lower, bottom.y, bottom.y, 0);
  }
  const faces = [
    { axis: "x", side: -1, lane: integer(6, 10) },
    { axis: "z", side: -1, lane: integer(-12, -8) },
    shattered
      ? { axis: "z", side: 1, lane: integer(-12, -8) }
      : { axis: "x", side: 1, lane: integer(-10, -6) },
  ] as const;

  const entrances = faces.map(({ axis, side, lane }) => {
    const floorY = outerY + integer(9, 11);
    const limit = (axis === "x" ? rx : rz) + 4;
    const point = (distance: number): Point => axis === "x" ? { x: distance * side, z: lane } : { x: lane, z: distance * side };
    let edge = limit;
    for (; edge > 0; edge--) {
      const { x, z } = point(edge);
      if (geology.rockColumn(x, z)(floorY) !== undefined) break;
    }
    const outside = point(edge);
    const threshold = point(edge - 4);
    const level = decks[0];
    const landing = point(edge - 4 - Math.max(2, floorY - level.y));
    const chamber = level.rooms.reduce((a, b) =>
      Math.abs(a.x - landing.x) + Math.abs(a.z - landing.z) <= Math.abs(b.x - landing.x) + Math.abs(b.z - landing.z) ? a : b);

    // Carve a narrow slit through any overhang in front of the natural rock ledge.
    for (let distance = edge + 1; distance <= limit; distance++) {
      const { x, z } = point(distance);
      for (let h = 1; h <= 3; h++) air.add(voxelKey(x, floorY + h, z));
    }
    tunnel([outside, threshold], floorY, floorY, 0, true);
    tunnel([threshold, landing], floorY, level.y, 0, true);
    tunnel([landing, chamber], level.y, level.y, 0);
    return { outside: { ...outside, y: floorY + 1 }, inside: { ...threshold, y: floorY + 1 } };
  });
  for (const { x, y, z, clearance } of floors.values()) {
    for (let h = 1; h <= clearance; h++) air.add(voxelKey(x, y + h, z));
  }
  // A staircase needs an extra block of headroom at a curved tunnel junction.
  for (const key of floors.keys()) air.delete(key);

  const eX = rx + 23;
  const eZ = rz + (condition === "skid" ? 39 : 23);
  const terrain: Voxel[] = [];
  for (let x = -eX; x <= eX; x++) for (let z = -eZ; z <= eZ; z++) {
    const { y, block } = geology.groundAt(x, z);
    ground.set(columnKey(x, z), y);
    terrain.push({ x, y, z, block });
  }
  const groundY = (x: number, z: number) => ground.get(columnKey(x, z)) ?? -1;
  for (const { x, y, z, block } of terrain) {
    const adjacent = Math.min(...SIDES.map(([dx, , dz]) => groundY(x + dx, z + dz)));
    for (let fill = Math.min(y, -1, adjacent + 1); fill <= y; fill++) {
      put(x, fill, z, fill === y ? block : B.CoarseDirt);
    }
    for (let clear = y + 1; clear <= -1; clear++) put(x, clear, z, B.Air);
  }

  for (let x = -rx - 4; x <= rx + 4; x++) for (let z = -rz - 7; z <= rz + 7; z++) {
    const sample = geology.rockColumn(x, z);
    for (let y = -profile.height - 3; y <= profile.height + 16; y++) {
      const block = sample(y);
      if (block === undefined) continue;
      const key = voxelKey(x, y, z);
      if (!air.has(key)) rock.set(key, { x, y, z, block });
    }
  }
  if (shattered || condition === "skid") {
    const fragments = shattered
      ? [[rx + 8, -9, 6], [rx + 4, 12, 5], [rx + 13, 6, 3], [rx - 2, rz + 6, 4], [rx + 7, -rz - 5, 3]]
      : [[-13, -rz - 17, 3], [3, -rz - 12, 4], [-17, -rz - 8, 4], [9, -rz - 3, 3]];
    for (const [cx, cz, radius] of fragments) {
      const base = groundY(cx, cz);
      for (let x = cx - radius; x <= cx + radius; x++) for (let z = cz - radius; z <= cz + radius; z++) {
        for (let y = Math.min(base, groundY(x, z)); y <= base + radius; y++) {
          const shape = ((x - cx) / radius) ** 2 + ((z - cz) / (radius * 0.7)) ** 2 + ((y - base) / radius) ** 2;
          const grain = noise(x, y, z);
          const key = voxelKey(x, y, z);
          if (shape > 0.83 + grain * 0.25 || air.has(key) || floors.has(key)) continue;
          const block = grain > 0.83 ? B.BrownTerracotta : grain > 0.45 ? B.Stone : B.Basalt;
          rock.set(key, { x, y, z, block });
        }
      }
    }
  }
  for (const [key, voxel] of rock) blocks.set(key, voxel);
  for (const key of air) {
    const [x, y, z] = key.split(",").map(Number);
    if (y < 0) put(x, y, z, B.Air);
    else blocks.delete(key);
  }
  for (const { x, y, z, clearance, rib } of floors.values()) {
    const grain = noise(x, y, z);
    const key = voxelKey(x, y, z);
    const bareRock = ledgeFloors.has(key);
    const floor = bareRock ? (rock.get(key)?.block ?? B.Basalt)
      : rib && grain > 0.63 ? B.Shroomlight
      : grain > 0.78 ? B.Moss : grain < 0.35 ? B.Basalt : B.Obsidian;
    put(x, y, z, floor);
    if (bareRock) continue;
    // Membrane on exposed rock gives the tubes seams that continue into the caverns.
    if (!rib && grain < 0.72) continue;
    for (const [dx, , dz] of SIDES) {
      const wall = voxelKey(x + dx, y + 2, z + dz);
      if ((rock.has(wall) || (y + 2 <= groundY(x + dx, z + dz) && !air.has(wall))) && !floors.has(wall)) put(x + dx, y + 2, z + dz, rib && grain > 0.68 ? B.Shroomlight : MEMBRANE[Math.floor(grain * 3)]);
    }
    const roof = voxelKey(x, y + clearance + 1, z);
    if (rock.has(roof) && !floors.has(roof) && grain > 0.85) put(x, y + clearance + 1, z, B.CryingObsidian);
  }

  const sections = decks.map(({ name, y, rooms: caverns }) => {
    const rooms: UfoRoom[] = caverns.map(({ x, z, rx, rz, name }) => ({
      name, x0: x - rx, x1: x + rx, z0: z - rz, z1: z + rz,
      entry: { x, y: y + 1, z },
      breached: shattered && y >= outerY && x > profile.width * 0.30,
    }));
    for (const { entry: { x, z } } of rooms) put(x, y, z, B.Shroomlight);
    return { name, y, rooms };
  });
  const salvageRooms = sections.flatMap(({ y, rooms }) => rooms.map(({ name, x0, x1, z0, z1, entry }) => {
    const positions = [];
    for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) {
      if (floors.has(voxelKey(x, y, z)) && air.has(voxelKey(x, y + 1, z))) positions.push({ x, y: y + 1, z });
    }
    return { name, entry, positions };
  }));
  const chests = addSalvage(blocks, salvageRooms, { civilization: "blight", condition, seed, area: rx * rz });
  addAsteroidOre(blocks, rock, floors, air, rx, rz, seed);
  const deckViews = sections.map(({ name, y, rooms }) => {
    const cutaway = [...blocks.values()].filter((voxel) =>
      voxel.block !== B.Air && voxel.y >= y && voxel.y <= y + 2 &&
      Math.abs(voxel.x) <= rx + 3 && Math.abs(voxel.z) <= rz + 3 &&
      (rock.has(voxelKey(voxel.x, voxel.y, voxel.z)) || floors.has(voxelKey(voxel.x, voxel.y, voxel.z)) ||
        voxel.block === B.Chest || voxel.block === B.TrappedChest || voxel.block === B.CryingObsidian || voxel.block === B.Shroomlight ||
        voxel.block === B.Moss || voxel.block === B.Obsidian));
    return { name, floorY: y, cutaway, rooms };
  });

  const exterior: Voxel[] = [];
  for (const voxel of blocks.values()) {
    const { x, y, z, block } = voxel;
    const buried = y < groundY(x, z) && SIDES.every(([dx, , dz]) => y <= groundY(x + dx, z + dz));
    if (block === B.Air || buried || !NEIGHBORS.some(([dx, dy, dz]) => {
      const neighbor = blocks.get(voxelKey(x + dx, y + dy, z + dz));
      return neighbor ? neighbor.block === B.Air : y + dy > groundY(x + dx, z + dz);
    })) continue;
    exterior.push(voxel);
  }

  return {
    seed, civilization: "blight", hull, condition, spawn, entrances, chests, decks: deckViews,
    title: `${UFO_HULLS[hull]} · ${conditionLabel("blight", condition)}`,
    blocks: [...blocks.values()], exterior, width: rx * 2 + 9, length: rz * 2 + 9,
  };
}
