import { buildCeilings } from "./ceilings";
import { detailSuburban } from "./facade";
import { detailCraftsman, buildCraftsmanPorch } from './craftsman-details';
import { detailFarmhouse } from "./farmhouse";
import type { RoofVolume } from "./roofs";
import { Block as B, type BlockId } from '@/lib/blocks';
import type { House, LootLocation, LootStack } from './generate';
import type { HousePlan, Volume, RoomUse } from './plan';
import type { HouseStyle } from './catalog';

type Materials = { style: HouseStyle; rank: number; wall: BlockId; accent: BlockId; trim: BlockId; roofBlock: BlockId; customRoof?: boolean };
export function buildHouse(plan: HousePlan, m: Materials, random: () => number, loot: (label: LootLocation) => LootStack[]): Pick<House, 'blocks' | 'beds' | 'chests' | 'spawn' | 'floors'> {
  const cells = new Map<string, BlockId>();
  const beds: House['beds'] = [], chests: House['chests'] = [];
  const h = m.style === 'pnw_modern' || m.style === 'pnw_lodge' ? 5 : 4;
  const modern = m.style === 'pnw_modern';
  const suburban = m.style === 'suburban';
  const ranch = m.style === 'ranch';
  const craftsman = m.style === 'craftsman';
  const lodge = m.style === 'pnw_lodge';
  const slabRoof = (suburban || ranch || craftsman) && !(m.customRoof && m.roofBlock !== B.RoofTiles && m.roofBlock !== B.RoofSlab);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, b: BlockId | null) => b === null ? cells.delete(key(x,y,z)) : cells.set(key(x,y,z), b);
  const fill = (x1: number,y1: number,z1: number,x2: number,y2: number,z2: number,b: BlockId | null) => {
    for(let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) for(let z=z1;z<=z2;z++) set(x,y,z,b);
  };
  const inside = (v: Pick<Volume, "x" | "z" | "w" | "d">, x: number,z: number) => x >= v.x && x < v.x+v.w && z >= v.z && z < v.z+v.d;
  const interior = (v: Pick<Volume, "x" | "z" | "w" | "d">, x: number,z: number) => x > v.x && x < v.x+v.w-1 && z > v.z && z < v.z+v.d-1;
  const roofHeight = (v: RoofVolume,x: number,z: number) => {
    const dx=Math.min(x-v.x+1,v.x+v.w-x), dz=Math.min(z-v.z+1,v.z+v.d-z);
    const slope = v.ridge === 'x' ? dz : dx;
    return v.stories*h + (v.roof === 'flat' ? 0 : v.roof === 'hip' ? (slabRoof ? Math.floor(Math.min(dx,dz)/v.pitch*2)/2 : Math.floor(Math.min(dx,dz)/v.pitch)) : v.roof === 'shed' ? Math.floor((v.ridge === 'x' ? z-v.z+1 : x-v.x+1)/3) : (slabRoof ? Math.floor(slope/v.pitch*2)/2 : Math.floor(slope/v.pitch)));
  };
  // Shell first, then all roofs, then openings. No wing can seal a previously cut door.
  for (const v of plan.volumes) {
    const x2=v.x+v.w-1, z2=v.z+v.d-1;
    fill(v.x,-1,v.z,x2,-1,z2,m.accent);
    for(let y=0;y<v.stories*h;y++) {
      for(let x=v.x;x<=x2;x++) for(let z=v.z;z<=z2;z++) {
        const edge=!interior(v,x,z);
        if(y%h===0) set(x,y,z,v.use==='Bathroom'||v.use==='Garage'?B.LightGrayConcrete:B.OakPlanks);
        else if(edge) {
          const exterior=!plan.volumes.some(other=>other!==v && inside(other,x,z) && other.stories*h>y);
          const body = plan.envelopes.find(e=>e.rooms.includes(v.id))!;
          const corner=(x===body.x||x===body.x+body.w-1)&&(z===body.z||z===body.z+body.d-1);
          const along=x===v.x||x===x2?z-v.z:x-v.x;
          const window=exterior&&!corner&&along>1&&along<(x===v.x||x===x2?v.d:v.w)-2&&(modern?along%5!==0:lodge?along%4!==0:along%5===2||along%5===3)&&y%h>=(lodge||modern?1:2)&&y%h<h-1&&v.use!=='Garage';
          const lodgePost = lodge && exterior && !corner && along % 4 === 0 && v.use !== 'Garage';
          const modernMullion = modern && exterior && !corner && along % 5 === 0 && v.use !== 'Garage';
          const modernSoffit = modern && exterior && !corner && y % h === h - 1;
          set(x,y,z,window?B.Glass:corner||lodgePost||modernMullion?m.trim:modernSoffit?B.StrippedSpruce:plan.envelopes.findIndex(e=>e.rooms.includes(v.id))%3===1&&modern?m.accent:m.wall);
        }
      }
    }
  }
  buildCeilings(plan, h, set);
  // A maximum-height roof envelope resolves intersections instead of allowing
  // one wing's eaves to protrude into a taller wing's rooms.
  const roofCells = new Map<string,{y:number;edge:boolean}>();
  for(const v of plan.roofs) for(let x=v.x-1;x<=v.x+v.w;x++) for(let z=v.z-1;z<=v.z+v.d;z++) {
    const y=roofHeight(v,x,z), k=`${x},${z}`;
    if(plan.volumes.some(other=>inside(other,x,z)&&other.stories*h>y)) continue;
    const current=roofCells.get(k);
    if(!current||current.y<y) roofCells.set(k,{y,edge:!inside(v,x,z)});
    if(inside(v,x,z)&&!interior(v,x,z)) fill(x,v.stories*h,z,x,Math.ceil(y)-1,z,m.wall);
  }
  for(const [k,{y,edge}] of roofCells) {
    const [x,z]=k.split(',').map(Number);
    set(x,Math.floor(y),z,slabRoof ? (Number.isInteger(y) ? B.RoofSlab : B.RoofTiles) : lodge && edge ? B.OakPlanks : (edge && m.style !== 'farmhouse') ? m.trim : m.roofBlock);
  }
  if(lodge) {
    // Stone fireplace chimney rising on a side exterior wall 3 blocks above the roofline.
    const mainEnv = plan.envelopes[0]!;
    const chimX = mainEnv.x;
    const chimZ = mainEnv.z + Math.floor(mainEnv.d / 2);
    const roofAtChim = roofCells.get(`${chimX},${chimZ}`)?.y ?? mainEnv.stories * h;
    const chimTop = Math.floor(roofAtChim) + 3;
    fill(chimX, 0, chimZ, chimX, chimTop, chimZ + 1, m.accent);
  }
  if(suburban || ranch) detailSuburban(plan, h, m.wall, m.accent, set, ranch);
  if(craftsman) detailCraftsman(plan, h, m.wall, m.accent, m.trim, set);
  if(m.style==='farmhouse') detailFarmhouse(plan, h, m.wall, m.accent, m.trim, set);
  const opening=(x:number,z:number,side:boolean,y=0)=> {
    set(x,y+1,z,side?B.OakDoorEastLower:B.OakDoorLower);
    set(x,y+2,z,side?B.OakDoorEastUpper:B.OakDoorUpper);
  };
  for(const c of plan.connections) {
    opening(c.x,c.z,c.side);
    if(plan.volumes[c.a].stories > 1 && plan.volumes[c.b].stories > 1) opening(c.x,c.z,c.side,h);
  }
  opening(plan.entry.x,plan.entry.z,false);
  const roomNames: string[][]=[[],[]];
  let safePlaced=false;
  const hasGarage=plan.volumes.some(v=>v.use==='Garage');
  let ranchBedroomChestPlaced=false;
  for(const v of plan.volumes) {
    const cx=Math.floor(v.x+v.w/2), cz=Math.floor(v.z+v.d/2);
    const exits=plan.connections.filter(c=>c.a===v.id||c.b===v.id);
    const reserved=new Set<string>();
    const reserve=(x:number,z:number)=>reserved.add(`${x},${z}`);
    const route=(x:number,z:number)=> {
      // Move away from the shared edge before turning toward the room center.
      const ix=Math.max(v.x+1,Math.min(v.x+v.w-2,x));
      const iz=Math.max(v.z+1,Math.min(v.z+v.d-2,z));
      for(let xx=Math.min(ix,cx);xx<=Math.max(ix,cx);xx++) reserve(xx,iz);
      for(let zz=Math.min(iz,cz);zz<=Math.max(iz,cz);zz++) reserve(cx,zz);
      reserve(x,z);
    };
    exits.forEach(c=>route(c.x,c.z));
    if(v.id===0) route(plan.entry.x,plan.entry.z);
    if(v.stories>1 && v.use==='Living room') {
      for(let x=v.x+1;x<=v.x+h+3;x++) for(let z=v.z+1;z<=v.z+3;z++) reserve(x,z);
      route(v.x+h+3,v.z+2); route(v.x+1,v.z+2);
    }
    if(v.use==='Garage') {
      const bayOptions=[
        {x:cx,z:v.z+v.d-1,dx:0,dz:1,side:false},
        {x:cx,z:v.z,dx:0,dz:-1,side:false},
        {x:v.x,z:cz,dx:-1,dz:0,side:true},
        {x:v.x+v.w-1,z:cz,dx:1,dz:0,side:true},
      ];
      const bay=plan.garageDoor ?? bayOptions.find(p=>Array.from({length:6},(_,i)=>i+1).every(n=>[-2,-1,0,1,2].every(t=>!plan.volumes.some(o=>o!==v&&inside(o,p.x+p.dx*n+(p.side?0:t),p.z+p.dz*n+(p.side?t:0))))));
      if(bay) {
        route(bay.x,bay.z);
        if(!suburban && !ranch && !craftsman) for(let t=-1;t<=1;t++) fill(bay.x+(bay.side?0:t),1,bay.z+(bay.side?t:0),bay.x+(bay.side?0:t),2,bay.z+(bay.side?t:0),null);
        for(let n=1;n<=6;n++) for(let t=-2;t<=2;t++) set(bay.x+bay.dx*n+(bay.side?0:t),-1,bay.z+bay.dz*n+(bay.side?t:0),B.GrayConcrete);
      }
    }
    for(let story=0;story<v.stories;story++) {
      const y=story*h, use:RoomUse=story ? (v.use==='Living room' ? 'Family room' : v.use==='Kitchen / dining' ? 'Study' : v.use) : v.use;
      roomNames[story].push(use);
      const spots:{x:number;z:number;score:number}[]=[];
      for(let x=v.x+1;x<v.x+v.w-1;x++) for(let z=v.z+1;z<v.z+v.d-1;z++) {
        const edge=x===v.x+1||x===v.x+v.w-2||z===v.z+1||z===v.z+v.d-2;
        spots.push({x,z,score:random()+(edge?2:0)});
      }
      spots.sort((a,b)=>b.score-a.score);
      const free=(x:number,z:number)=>interior(v,x,z)&&!reserved.has(`${x},${z}`)&&!cells.has(key(x,y+1,z));
      const put=(block:BlockId,label?:LootLocation,near?:{x:number;z:number})=> {
        const available=spots.filter(p=>free(p.x,p.z));
        if(near) available.sort((a,b)=>(Math.abs(a.x-near.x)+Math.abs(a.z-near.z))-(Math.abs(b.x-near.x)+Math.abs(b.z-near.z)));
        const pos=available[0];
        if(!pos) throw new Error(`No furnishing space in ${use}`);
        set(pos.x,y+1,pos.z,block);
        if(label) chests.push({...pos,y:y+1,label,items:loot(label)});
        return pos;
      };
      if(use==='Bedroom') {
        const bed=spots.find(p=>free(p.x,p.z)&&free(p.x,p.z+1));
        if(!bed) throw new Error('Bedroom has no bed clearance');
        set(bed.x,y+1,bed.z,B.BedHead); set(bed.x,y+1,bed.z+1,B.BedFoot);
        beds.push({x:bed.x,y:y+1,z:bed.z},{x:bed.x,y:y+1,z:bed.z+1});
        if(!ranch || (!hasGarage && !ranchBedroomChestPlaced)) {
          const label=m.rank===3&&!safePlaced?'Private safe':'Bedroom storage';
          put(B.Chest,label); if(label==='Private safe') safePlaced=true;
          if(ranch) ranchBedroomChestPlaced=true;
        }
        put(B.Bookshelf);
      } else if(use==='Kitchen / dining') {
        const counter=put(B.Furnace);
        put(B.CraftingTable,undefined,counter); put(B.Quartz,undefined,counter);
        put(B.Chest,'Pantry',counter);
        if(m.rank>0) {
          const table=put(B.OakPlanks);
          put(B.OakStairSouth,undefined,table);put(B.OakStairNorth,undefined,table);
        }
      } else if(use==='Bathroom') {
        put(B.Quartz);put(B.Quartz);put(B.Glass);
      } else if(use==='Hallway') {
        // Circulation space remains empty on every floor.
      } else if(use==='Garage') { put(B.Chest,'Tool storage');put(B.CraftingTable); }
      else {
        const sofa=put(B.WhiteWool);
        put(B.WhiteWool,undefined,sofa);put(B.WhiteWool,undefined,sofa);
        put(B.QuartzSlab,undefined,sofa);put(B.BlackConcrete);
        if(use==='Study') {put(B.Bookshelf);put(B.Bookshelf);}
        if(v.id===0 && !ranch) put(B.Chest,m.rank>=2?'Lake gear':'Tool storage');
      }
      // Integrate lights flush into the ceiling (when covered by roof above) or an interior wall,
      // rather than protruding down into the room air.
      const light = m.rank > 1 ? B.SeaLantern : B.Glowstone;
      const ceilingY = y + h;
      const hasRoofAbove = (x: number, z: number) => {
        const roof = roofCells.get(`${x},${z}`);
        return roof !== undefined && Math.floor(roof.y) > ceilingY;
      };
      let lightPlaced = false;
      if (story === v.stories - 1) {
        if (hasRoofAbove(cx, cz)) {
          set(cx, ceilingY, cz, light);
          lightPlaced = true;
        } else {
          const ceilingSpots: { x: number; z: number; dist: number }[] = [];
          for (let x = v.x + 1; x < v.x + v.w - 1; x++) for (let z = v.z + 1; z < v.z + v.d - 1; z++) {
            if (hasRoofAbove(x, z)) ceilingSpots.push({ x, z, dist: Math.abs(x - cx) + Math.abs(z - cz) });
          }
          ceilingSpots.sort((a, b) => a.dist - b.dist);
          if (ceilingSpots[0]) {
            set(ceilingSpots[0].x, ceilingY, ceilingSpots[0].z, light);
            lightPlaced = true;
          }
        }
      }
      if (!lightPlaced) {
        const ly = y + h - 1;
        const wallSpots: { x: number; z: number; dist: number; shared: boolean }[] = [];
        for (let x = v.x; x < v.x + v.w; x++) for (let z = v.z; z < v.z + v.d; z++) {
          const onX = x === v.x || x === v.x + v.w - 1;
          const onZ = z === v.z || z === v.z + v.d - 1;
          if (onX === onZ) continue; // skip interior and corners
          const existing = cells.get(key(x, ly, z));
          if (existing === undefined || existing === B.Glass) continue;
          const shared = plan.volumes.some(other => other !== v && inside(other, x, z) && other.stories * h > ly);
          wallSpots.push({ x, z, dist: Math.abs(x - cx) + Math.abs(z - cz), shared });
        }
        wallSpots.sort((a, b) => Number(b.shared) - Number(a.shared) || a.dist - b.dist);
        if (wallSpots[0]) {
          set(wallSpots[0].x, ly, wallSpots[0].z, light);
        } else {
          set(cx, ceilingY, cz, light);
        }
      }
    }
    if(v.stories>1 && v.use==='Living room') {
      for(let i=0;i<h;i++) {
        const x=v.x+h+1-i,z=v.z+2;
        set(x,i+1,z,B.OakStairWest);
        fill(x,i+2,z,x,h+3,z,null);
      }
      fill(v.x+1,h+1,v.z+2,v.x+1,h+2,v.z+2,null);
    }
  }
  const {x:entryX,z:entryZ}=plan.entry;
  const porchWidth=m.style==='manufactured'?1:suburban?2:2+Math.floor(random()*2);
  const porchDepth=plan.porch?.d ?? 2+Math.floor(random()*3);
  if(craftsman && plan.porch) buildCraftsmanPorch(plan, h, m.accent, m.trim, set);
  else fill(entryX-porchWidth,0,entryZ+1,entryX+porchWidth,0,entryZ+porchDepth,m.style==='farmhouse'||lodge?B.SprucePlanks:B.OakPlanks);
  if(plan.porchCanopy && !craftsman) {
    for(const x of [entryX-porchWidth,entryX+porchWidth]) {
      if(suburban) {
        set(x,1,entryZ+porchDepth,m.accent);
        fill(x,2,entryZ+porchDepth,x,h-1,entryZ+porchDepth,m.trim);
        for(let z=entryZ+1;z<entryZ+porchDepth;z++) set(x,1,z,B.OakFence);
      } else if(m.style==='farmhouse' || lodge) {
        // Stone pier bases, heavy spruce timber posts, and spruce porch railings.
        set(x,1,entryZ+porchDepth,m.accent);
        fill(x,2,entryZ+porchDepth,x,h-1,entryZ+porchDepth,B.SpruceLog);
        for(let z=entryZ+1;z<entryZ+porchDepth;z++) set(x,1,z,B.SpruceFence);
      } else {
        fill(x,1,entryZ+porchDepth,x,h-1,entryZ+porchDepth,m.trim);
      }
    }
    if(m.style==='farmhouse' || lodge) {
      // Heavy timber header beam across the porch front.
      fill(entryX-porchWidth,h-1,entryZ+porchDepth,entryX+porchWidth,h-1,entryZ+porchDepth,B.StrippedSpruce);
    }
    if(suburban) {
      for(let x=entryX-porchWidth-1;x<=entryX+porchWidth+1;x++) for(let z=entryZ;z<=entryZ+porchDepth+1;z++) {
        const rise=(porchWidth+1-Math.abs(x-entryX))/2;
        if(z===entryZ+porchDepth) fill(x,h,z,x,h+Math.ceil(rise)-1,z,m.wall);
        set(x,h+Math.floor(rise),z,Number.isInteger(rise)?B.RoofSlab:B.RoofTiles);
      }
    } else fill(entryX-porchWidth-1,h,entryZ+1,entryX+porchWidth+1,h,entryZ+porchDepth+1,m.roofBlock);
  }
  fill(entryX-1,-1,entryZ+porchDepth+1,entryX+1,-1,entryZ+porchDepth+7,B.Gravel);
  if(!craftsman) {
    if(suburban || m.style==='farmhouse' || lodge) {
      set(entryX-porchWidth,2,entryZ+porchDepth+1,B.Lantern);
      set(entryX+porchWidth,2,entryZ+porchDepth+1,B.Lantern);
    } else set(entryX-porchWidth,1,entryZ+1,B.Lantern);
  }
  // Give each wing an individually chosen roof height, but expose common floor cuts.
  return {
    blocks:[...cells.entries()].map(([k,block])=>{const [x,y,z]=k.split(',').map(Number);return {x,y,z,block};}),beds,chests,
    spawn:{x:entryX,y:0,z:entryZ+porchDepth+6},
    floors:roomNames.flatMap((rooms,i)=>rooms.length?[{floorY:i*h,cutY:(i+1)*h,rooms}]:[]),
  };
}
