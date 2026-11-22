import type { AsteroidHull } from "./catalog";

export type Point = { x: number; z: number };
export type Cavern = Point & { name: string; rx: number; rz: number; clearance: number };

const STRATA = [
  { name: "Crown", offset: 9, hub: "Crown cyst", ring: ["Blind gallery", "Hollow crown", "Vein chapel", "Spore vents", "Shell nest", "Root curtain", "Watch hollow", "Glass seam"] },
  { name: "Outer tunnels", offset: 0, hub: "Brood crossing", ring: ["Entry fissure", "Blister garden", "Echo gallery", "Fossil vault", "Root maze", "Shell nursery", "Chitin gallery", "Scavenger pocket"] },
  { name: "Feeder galleries", offset: -8, hub: "Feeder junction", ring: ["Drain hollow", "Molting pocket", "Cradle shaft", "Feeding gallery", "Spindle nest", "Rib chamber", "Larval gallery", "Relic cache"] },
  { name: "Deep core", offset: -16, hub: "Pulse chamber", ring: ["Buried cache", "Black reservoir", "Calcified brood", "Lower cistern", "Vein knot", "Ash follicles", "Sleeping vault", "Spore sink"] },
] as const;

export function planAsteroidCaves(rx: number, rz: number, outerY: number, hull: AsteroidHull, random: () => number) {
  const integer = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const rampX = Math.round(rx * 0.72);
  const decks = STRATA.map(({ name, offset, hub, ring }, index) => {
    const branchCount = hull === "hiveCluster" ? 3 : integer(2, 3);
    const phase = random() * Math.PI / 4;
    const missingSegment = integer(0, 9);
    const span = index === 3 ? 0.50 : 0.59;
    const center = { x: integer(-2, 2), z: integer(-2, 2), name: hub, rx: 5, rz: 5, clearance: 5 };
    const rim: Cavern[] = ring.map((name, i) => {
      const angle = phase + (i + (random() - 0.5) * 0.26) * Math.PI / 4;
      return {
        name,
        x: Math.round(Math.cos(angle) * rx * (span + random() * 0.04)),
        z: Math.round(Math.sin(angle) * rz * (span + random() * 0.04)),
        rx: integer(2, 4), rz: integer(2, 4), clearance: integer(3, 5),
      };
    });
    const branches: Cavern[] = [];
    const routes: Point[][] = [];
    for (const [i, pocket] of rim.entries()) {
      const next = rim[(i + 1) % rim.length];
      const x = Math.round((pocket.x + next.x) * 0.55);
      const z = Math.round((pocket.z + next.z) * 0.55);
      if (i !== missingSegment) routes.push([pocket, { x, z }, next]);
      if ((i + index) % 2 === 0) {
        routes.push([pocket, { x: Math.round(pocket.x * 0.48) + integer(-1, 1), z: Math.round(pocket.z * 0.48) + integer(-1, 1) }, center]);
      }
      if (i % 3 === index % 3 && branches.length < branchCount) {
        const branch: Cavern = {
          name: ["Blind pocket", "Molt alcove", "Sealed burrow"][branches.length],
          x: Math.max(-rampX + 3, Math.min(rampX - 3, Math.round(pocket.x * 0.65 - pocket.z * 0.25))),
          z: Math.round(pocket.z * 0.65 + pocket.x * 0.25),
          rx: 2, rz: 2, clearance: 3,
        };
        branches.push(branch);
        routes.push([pocket, branch]);
      }
    }
    const shortcut = integer(0, rim.length - 1);
    routes.push([rim[shortcut], { x: center.x + 4, z: center.z - 3 }, rim[(shortcut + 3) % rim.length]]);
    return { name, y: outerY + offset, rooms: [center, ...rim, ...branches], routes };
  });

  // Twin ramps run down opposite sides. Alternating their Z bands keeps a
  // descent clear of the ramp on the level immediately above or below it.
  const connectors = decks.slice(0, -1).flatMap((top, i) => {
    const bottom = decks[i + 1];
    const z = i % 2 === 0 ? -10 : 3;
    return [-1, 1].map((side) => {
      const start = { x: side * rampX, z };
      const end = { x: side * rampX, z: z + top.y - bottom.y + 1 };
      const connect = (point: Point, rooms: Cavern[]) => {
        const nearest = rooms.reduce((a, b) =>
          Math.abs(a.x - point.x) + Math.abs(a.z - point.z) <= Math.abs(b.x - point.x) + Math.abs(b.z - point.z) ? a : b);
        return [point, { x: point.x - side * 2, z: point.z }, nearest];
      };
      return { top, bottom, start, end, upper: connect(start, top.rooms), lower: connect(end, bottom.rooms) };
    });
  });
  return { decks, connectors };
}
