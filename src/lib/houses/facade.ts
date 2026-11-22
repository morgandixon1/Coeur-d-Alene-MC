import { Block as B, type BlockId } from '@/lib/blocks';
import type { HousePlan } from './plan';

/** Facade bays belong to the composition. The garage, entrance and rooms share
 * sill/header heights; one large living-room window replaces arbitrary stripes. */
export function detailSuburban(plan:HousePlan,h:number,wall:BlockId,accent:BlockId,set:(x:number,y:number,z:number,b:BlockId|null)=>unknown,ranch=false) {
  const main=plan.envelopes[0],garage=plan.volumes.find(v=>v.use==='Garage');
  const occupied=(x:number,z:number,y:number)=>plan.envelopes.some(e=>x>=e.x&&x<e.x+e.w&&z>=e.z&&z<e.z+e.d&&y<e.stories*h);
  const exterior=(x:number,z:number,y:number)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>!occupied(x+dx,z+dz,y));
  for(const e of plan.envelopes) {
    for(let x=e.x;x<e.x+e.w;x++) for(let z=e.z;z<e.z+e.d;z++) {
      if(x!==e.x&&x!==e.x+e.w-1&&z!==e.z&&z!==e.z+e.d-1) continue;
      for(let y=0;y<e.stories*h;y++) if(exterior(x,z,y)) {
        set(x,y,z,y===0?accent:wall);
      }
    }
  }
  for(const room of plan.volumes.filter(v=>!['Hallway','Garage'].includes(v.use))) {
    for(let story=0;story<room.stories;story++) {
      const y=story*h;
      const bathroom=room.use==='Bathroom';
      for(const z of [room.z,room.z+room.d-1]) {
        const faceFront=z===(room.id===0?plan.entry.z:0), faceBack=z===main.z;
        if(!ranch&&!faceFront&&!faceBack) continue;
        let center=Math.floor(room.x+room.w/2);
        if(faceFront&&story===0&&room.id===0) center=plan.entry.x<center?room.x+room.w-4:room.x+3;
        const half=bathroom?0:1;
        for(let x=center-half;x<=center+half;x++) {
          if(!exterior(x,z,y+2)) continue;
          set(x,y+2,z,B.Glass);
          if(!bathroom) set(x,y+3,z,B.Glass);
          if(!bathroom) set(x,y+1,z,B.Quartz);
        }
      }
      // Side-facing bedroom windows make the gable walls read as inhabited rooms.
      for(const x of [room.x,room.x+room.w-1]) {
        const z=Math.floor(room.z+room.d/2);
        if(!exterior(x,z,y+2)||x!==main.x&&x!==main.x+main.w-1) continue;
        for(let dz=-1;dz<=1;dz++) if(exterior(x,z+dz,y+2)) {
          set(x,y+2,z+dz,B.Glass);if(!bathroom)set(x,y+3,z+dz,B.Glass);
        }
      }
    }
  }
  // A broad, paneled garage opening establishes the front elevation.
  if(garage) {
    const door=plan.garageDoor ?? {x:garage.x+Math.floor(garage.w/2),z:garage.z+garage.d-1,side:false};
    const half=Math.min(3,Math.floor(((door.side?garage.d:garage.w)-3)/2));
    for(let offset=-half;offset<=half;offset++) for(let y=1;y<=3;y++) {
      set(door.x+(door.side?0:offset),y,door.z+(door.side?offset:0),y===3&&offset%3!==0?B.Glass:B.WhiteWool);
    }
  }
  const ex=plan.entry.x;
  set(ex-1,2,plan.entry.z,B.Quartz);set(ex+1,2,plan.entry.z,B.Quartz);
  // Simple planted beds flank the entry without blocking the walk or driveway.
  for(const x of [main.x+2,main.x+main.w-3]) if(Math.abs(x-ex)>3) {
    set(x,-1,1,B.CoarseDirt);set(x,0,1,B.SpruceLeaves);
    set(x+1,-1,1,B.CoarseDirt);set(x+1,0,1,B.SpruceLeaves);
  }
}
