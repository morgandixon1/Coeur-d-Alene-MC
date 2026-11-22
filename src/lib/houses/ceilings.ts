import { Block, type BlockId } from '@/lib/blocks';
import type { HousePlan } from './plan';

/** Rooms finish at the wall plate; the pitched roof encloses a separate attic.
 * Build before roof finishes and stair carving, so roof shape cannot leave
 * open partitions and intentional stair openings remain traversable. */
export function buildCeilings(plan: HousePlan, storyHeight: number, set: (x:number,y:number,z:number,block:BlockId)=>unknown) {
  for (const room of plan.volumes) {
    const y=room.stories*storyHeight;
    for(let x=room.x;x<room.x+room.w;x++) for(let z=room.z;z<room.z+room.d;z++) set(x,y,z,Block.WhiteWool);
  }
}
