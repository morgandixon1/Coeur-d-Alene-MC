import type { BlockId } from "@/lib/blocks";

export type VoxelPosition = { x: number; y: number; z: number };
export type Voxel = VoxelPosition & { block: BlockId };
