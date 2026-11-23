import { planRanch } from "./ranch";
import { planCraftsman } from './craftsman';
import { planSuburban } from "./suburban";
import { planFarmhouse } from "./farmhouse";
import type { RoofVolume } from './roofs';
import type { HouseStyle, HousePrice } from './catalog';
import { ARCHITECTURE } from './architecture';

export type RoomUse = 'Living room' | 'Kitchen / dining' | 'Bedroom' | 'Bathroom' | 'Garage' | 'Study' | 'Family room' | 'Hallway';
export type Volume = {
  id: number; x: number; z: number; w: number; d: number;
  use: RoomUse; stories: number;
};
export type Envelope = { x: number; z: number; w: number; d: number; stories: number; rooms: number[]; ridge?: "x" | "z"; roof?: "gable" | "hip" | "shed" | "flat" | "shallow" };
export type Connection = { a: number; b: number; x: number; z: number; side: boolean };
export type HousePlan = {
  porch?: { x:number; z:number; w:number; d:number; roof:'gable'|'shed' };
  garageDoor?: { x:number;z:number;side:boolean;dx:number;dz:number };
  family: string; volumes: Volume[]; envelopes: Envelope[]; connections: Connection[];
  entry: { x: number; z: number }; signature: string; roofs: RoofVolume[]; porchCanopy: boolean;
};

/** Choose a bounded building envelope before dividing its interior into rooms.
 * Room count never controls the number of exterior wings or roofs. */
export function planHouse(style: Exclude<HouseStyle, 'any'>, price: Exclude<HousePrice, 'any'>, random: () => number): HousePlan {
  if (style === 'ranch') return planRanch(price, random);
  if (style === 'craftsman') return planCraftsman(price, random);
  if (style === 'suburban') return planSuburban(price, random);
  if (style === 'farmhouse') return planFarmhouse(price, random);
  const int = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
  const rank = ['starter', 'mid', 'upscale', 'luxury'].indexOf(price);
  const rules = ARCHITECTURE[style];
  const trailer = style === 'manufactured';
  const singleWide = trailer && (rank === 0 || random() < 0.45);
  const volumes: Volume[] = [];
  const envelopes: Envelope[] = [];
  const connections: Connection[] = [];
  const stories = !trailer && rank > 0 && random() < 0.6 ? 2 : 1;
  const add = (x: number, z: number, w: number, d: number, use: RoomUse, floors = stories) => {
    const v = { id: volumes.length, x, z, w, d, use, stories: floors };
    volumes.push(v);
    return v;
  };
  let family: string;
  if (singleWide) {
    // One long chassis and one roof. The program can change inside the rectangle.
    const widths = [int(6, 7), int(7, 9), int(6, 7), 5];
    const d = int(7, 8);
    const uses: RoomUse[] = ['Bedroom', 'Living room', 'Kitchen / dining', 'Bathroom'];
    if (random() < 0.45) { widths.splice(widths.length - 1, 0, 6); uses.splice(uses.length - 1, 0, 'Bedroom'); }
    if (random() < 0.5) { widths.reverse(); uses.reverse(); }
    const total = widths.reduce((sum, w) => sum + w - 1, 1);
    let x = -Math.floor(total / 2);
    const parts = widths.map((w, i) => { const part = { x, w, use: uses[i] }; x += w - 1; return part; });
    // Keep the entrance room at id zero; placement is independent of traversal order.
    for (const part of [...parts].sort((a, b) => Number(b.use === 'Living room') - Number(a.use === 'Living room'))) add(part.x, 1 - d, part.w, d, part.use, 1);
    envelopes.push({ x: -Math.floor(total / 2), z: 1 - d, w: total, d, stories: 1, rooms: volumes.map(v => v.id) });
    family = 'Single-wide';
  } else {
    // The interior grid partitions one main body, rather than growing a body per room.
    const cols = trailer ? [int(7, 8), int(7, 8), int(6, 7)] : [int(10, 12), int(8, 11), int(8, 11)];
    const frontD = trailer ? 6 : int(9, 11);
    const rearD = trailer ? 6 : int(7, 10);
    const w = cols.reduce((sum, size) => sum + size - 1, 1), d = frontD + rearD - 1;
    const x0 = -Math.floor(w / 2), z0 = 1 - d;
    const livingCol = trailer ? int(0, 1) : 0; // Larger stair-capable living room.
    const front: RoomUse[] = ['Kitchen / dining', 'Study', 'Bedroom'];
    front[livingCol] = 'Living room';
    front[(livingCol + 1) % 3] = 'Kitchen / dining';
    const rear: RoomUse[] = random() < 0.5 ? ['Bedroom', 'Bathroom', 'Bedroom'] : ['Bedroom', 'Bedroom', 'Bathroom'];
    if (trailer) front[(livingCol + 2) % 3] = 'Family room';
    const parts: { x: number; z: number; w: number; d: number; use: RoomUse }[] = [];
    let x = x0;
    for (let c = 0; c < 3; c++) {
      parts.push({ x, z: 1 - frontD, w: cols[c], d: frontD, use: front[c] });
      parts.push({ x, z: z0, w: cols[c], d: rearD, use: rear[c] });
      x += cols[c] - 1;
    }
    for (const part of parts.sort((a,b) => Number(b.use === 'Living room') - Number(a.use === 'Living room'))) add(part.x, part.z, part.w, part.d, part.use, stories);
    envelopes.push({ x: x0, z: z0, w, d, stories, rooms: volumes.map(v => v.id) });
    family = trailer ? 'Double-wide' : pick(['Compact main body', 'Side-wing', 'Rear-wing']);
    const bodies = trailer ? 1 : family === 'Compact main body' ? 1 : rank >= 2 ? int(2, rules.maxBodies) : 2;
    for (let i = 1; i < bodies; i++) {
      const wingW = int(8, 10), wingD = int(8, 10);
      const side = i === 1 && family === 'Side-wing';
      const left = random() < 0.5;
      const wx = side ? (left ? x0 - wingW + 1 : x0 + w - 1) : x0 + (i === 1 ? 0 : w - wingW);
      const wz = side ? -wingD + 1 - int(0, 2) : z0 - wingD + 1;
      const room = add(wx, wz, wingW, wingD, i === 1 ? 'Garage' : pick(['Family room', 'Study']), 1);
      envelopes.push({ x: wx, z: wz, w: wingW, d: wingD, stories: 1, rooms: [room.id] });
    }
  }
  // Derive legal door locations from shared walls, then choose a connected tree.
  // Bathrooms receive late edges so they don't become through-routes when avoidable.
  const edges: (Connection & { score: number })[] = [];
  for (const a of volumes) for (const b of volumes) if (a.id < b.id) {
    const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w - 1, b.x + b.w - 1);
    const z1 = Math.max(a.z, b.z), z2 = Math.min(a.z + a.d - 1, b.z + b.d - 1);
    const side = x1 === x2 && z2 - z1 >= 3;
    if (!side && !(z1 === z2 && x2 - x1 >= 3)) continue;
    edges.push({ a: a.id, b: b.id, x: side ? x1 : int(x1 + 1, x2 - 1), z: side ? int(z1 + 1, z2 - 1) : z1, side,
      score: random() + ([a.use, b.use].includes('Bathroom') ? 10 : [a.use, b.use].includes('Garage') ? 8 : [a.use, b.use].includes('Bedroom') ? 2 : 0) });
  }
  const groups = volumes.map(v => v.id);
  const group = (id: number): number => groups[id] === id ? id : group(groups[id]);
  for (const e of edges.sort((a,b) => a.score - b.score)) {
    if (group(e.a) === group(e.b)) continue;
    groups[group(e.b)] = group(e.a);
    const { a, b, x, z, side } = e;
    connections.push({ a,b,x,z,side });
  }
  if (connections.length !== volumes.length - 1) throw new Error('Disconnected house plan');
  const living = volumes[0];
  const entry = { x: int(living.x + 2, living.x + living.w - 3), z: 0 };
  const signature = JSON.stringify(volumes.map(({ x,z,w,d,use,stories }) => [x,z,w,d,use,stories]));
  return { family, volumes, envelopes, connections, entry, signature, roofs: [], porchCanopy: rules.porchCanopy && random() < 0.65 };
}
