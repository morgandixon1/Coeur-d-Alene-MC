import type { Voxel, VoxelPosition } from "@/lib/voxels";
import type { UfoCivilization, UfoCondition, UfoHull } from "./catalog";

export const voxelKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const columnKey = (x: number, z: number) => `${x},${z}`;

export type UfoRoom = {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  entry: VoxelPosition;
  breached: boolean;
};

export type Ufo = {
  seed: number;
  civilization: UfoCivilization;
  hull: UfoHull;
  condition: UfoCondition;
  spawn: VoxelPosition;
  entrances?: { outside: VoxelPosition; inside: VoxelPosition }[];
  chests: (VoxelPosition & { label: string; items: { name: string; count: number }[] })[];
  decks: { name: string; floorY?: number; cutaway: Voxel[]; rooms: UfoRoom[] }[];
  title: string;
  blocks: Voxel[];
  exterior: Voxel[];
  width: number;
  length: number;
};
