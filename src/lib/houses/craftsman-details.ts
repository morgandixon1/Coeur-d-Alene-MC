import { Block as B, type BlockId } from '@/lib/blocks';
import type { HousePlan } from './plan';
import { detailSuburban } from './facade';

type Setter=(x:number,y:number,z:number,b:BlockId|null)=>unknown;

/** Windows follow occupied rooms; stone, timber and gable detailing follow the
 * exterior envelope, so interior partitions never receive exterior decoration. */
export function detailCraftsman(plan:HousePlan,h:number,wall:BlockId,stone:BlockId,trim:BlockId,set:Setter) {
  detailSuburban(plan,h,wall,stone,set,true);
  const occupied=(x:number,z:number,y:number)=>plan.envelopes.some(e=>x>=e.x&&x<e.x+e.w&&z>=e.z&&z<e.z+e.d&&y<e.stories*h);
  for(const e of plan.envelopes) {
    for(let x=e.x;x<e.x+e.w;x++) for(let z=e.z;z<e.z+e.d;z++) {
      if(![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>!occupied(x+dx,z+dz,1))) continue;
      set(x,1,z,stone);
    }
  }
  for(const roof of plan.roofs) {
    const alongX=roof.ridge==='x', span=alongX?roof.d:roof.w;
    const start=alongX?roof.z:roof.x;
    for(const end of alongX?[roof.x,roof.x+roof.w-1]:[roof.z,roof.z+roof.d-1]) {
      for(let t=start;t<start+span;t++) {
        const x=alongX?end:t,z=alongX?t:end;
        const y=roof.stories*h, outX=alongX?(end===roof.x?-1:1):0,outZ=alongX?0:(end===roof.z?-1:1);
        if(occupied(x+outX,z+outZ,y-1)) continue;
        const rise=Math.floor(Math.min(t-start+1,start+span-t)/roof.pitch*2)/2;
        // Cedar infill beneath the rake, leaving the roof surface untouched.
        for(let yy=y;yy<Math.floor(y+rise);yy++) set(x,yy,z,B.SprucePlanks);
        if(rise>=1) set(x,y,z,trim);
        // Visible timber bracket ends beneath broad eaves.
        if((t-start===2||t-start===span-3)&&!occupied(x+outX,z+outZ,y-1)) set(x+outX,y-1,z+outZ,B.StrippedSpruce);
      }
    }
  }
  const door=plan.garageDoor,garage=plan.volumes.find(v=>v.use==='Garage');
  if(door&&garage) {
    const half=Math.min(3,Math.floor((garage.w-3)/2));
    for(let dx=-half;dx<=half;dx++) for(let y=1;y<=3;y++) set(door.x+dx,y,door.z,y===3&&dx%3!==0?B.Glass:B.SprucePlanks);
  }
  // Warm timber surround; the door itself is cut by the builder afterwards.
  for(const dx of [-1,1]) set(plan.entry.x+dx,2,plan.entry.z,trim);
}

export function buildCraftsmanPorch(plan:HousePlan,h:number,stone:BlockId,trim:BlockId,set:Setter) {
  const p=plan.porch!;const front=p.z+p.d-1,center=p.x+(p.w-1)/2;
  for(let x=p.x;x<p.x+p.w;x++) for(let z=p.z;z<=front;z++) {
    set(x,-1,z,stone);set(x,0,z,B.SprucePlanks);
    // Facade planting must not intrude into the planned porch footprint.
    set(x,1,z,null);
  }
  const posts=[p.x,p.x+p.w-1];
  if(p.w>=15) {
    const mid=Math.round(center);
    posts.push(Math.abs(mid-plan.entry.x)<=1?mid+3:mid);
  }
  for(const x of posts) {
    const inward=x===p.x+p.w-1?-1:1;
    for(const dx of [0,inward]) for(const z of [front-1,front]) set(x+dx,1,z,stone);
    for(let y=2;y<h;y++) set(x,y,front,B.SpruceLog);
    set(x,h-1,front-1,B.StrippedSpruce);
  }
  for(let x=p.x;x<p.x+p.w;x++) set(x,h-1,front,B.StrippedSpruce);
  for(let x=p.x-1;x<=p.x+p.w;x++) for(let z=p.z-1;z<=front+1;z++) {
    const rise=p.roof==='gable'?Math.floor(((p.w+1)/2-Math.abs(x-center))*1)/2:Math.floor((front+1-z)/2)/2;
    const y=h+Math.max(0,rise);
    if(z===front&&p.roof==='gable') for(let yy=h;yy<Math.floor(y);yy++) set(x,yy,z,trim);
    set(x,Math.floor(y),z,Number.isInteger(y)?B.RoofSlab:B.RoofTiles);
  }
  // One-block step across the entrance; supports leave a two-block-high route.
  for(let x=plan.entry.x-1;x<=plan.entry.x+1;x++) set(x,0,front+1,B.QuartzSlab);
  set(p.x+1,h-1,p.z,B.Lantern);
  set(p.x+p.w-2,h-1,p.z,B.Lantern);
}
