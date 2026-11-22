import type { HousePrice } from './catalog';
import type { Connection, Envelope, HousePlan, RoomUse, Volume } from './plan';

export type DesignReview = { accepted: boolean; issues: string[]; mainShare: number; compactness: number };

/** Reject a proposal before blocks are built. This measures geometry and access,
 * not aesthetic quality; visual comparison is still required. */
export function reviewSuburban(plan: HousePlan): DesignReview {
  const issues: string[] = [];
  const main=plan.envelopes[0], garage=plan.envelopes.at(-1)!;
  const mainArea=plan.envelopes.slice(0,-1).reduce((sum,e)=>sum+(e.w-1)*(e.d-1),0), garageArea=(garage.w-1)*(garage.d-1);
  const mainShare=mainArea/(mainArea+garageArea);
  const minX=Math.min(...plan.envelopes.map(e=>e.x)), maxX=Math.max(...plan.envelopes.map(e=>e.x+e.w));
  const minZ=Math.min(...plan.envelopes.map(e=>e.z)), maxZ=Math.max(...plan.envelopes.map(e=>e.z+e.d));
  const compactness=(mainArea+garageArea)/((maxX-minX)*(maxZ-minZ));
  if(mainShare<0.64) issues.push('Garage overwhelms the main body');
  if(compactness<0.64) issues.push('Footprint is too fragmented');
  if(garage.stories>=main.stories && garage.w>main.w*0.65) issues.push('Secondary roof is too wide');
  for(const v of plan.volumes) if(v.use==='Bedroom'||v.use==='Bathroom') {
    const links=plan.connections.filter(c=>c.a===v.id||c.b===v.id);
    if(links.length!==1) issues.push(`${v.use} is a circulation route`);
    if(!links.some(c=>plan.volumes[c.a===v.id?c.b:c.a].use==='Hallway')) issues.push(`${v.use} has no hall access`);
  }
  return {accepted:!issues.length,issues,mainShare,compactness};
}

/** A street-facing composition, not a collection of independently grown rooms.
 * The chosen grammar fixes relationships while dimensions, handedness, bedroom
 * proportions, garage projection and door positions remain variable. */
export function planSuburban(price: Exclude<HousePrice,'any'>, random:()=>number): HousePlan {
  const int=(a:number,b:number)=>a+Math.floor(random()*(b-a+1));
  const types=['Projecting garage ranch','Recessed garage ranch','Two-story gable','Cross-gable entry','Stepped-front ranch'] as const;
  const family=types[int(0,price==='starter'?1:4)];
  for(let attempt=0;attempt<24;attempt++) {
    const stories=family==='Two-story gable'?2:1;
    const mainW=int(18,21), frontD=stories===2?8:int(6,7), rearD=int(5,6), hallD=4;
    const mainD=frontD+hallD+rearD-2;
    const x=-Math.floor(mainW/2), rear=1-mainD;
    const garageLeft=random()<0.5;
    const livingW=int(9,10), kitchenW=mainW-livingW+1;
    const livingX=garageLeft?x+mainW-livingW:x;
    const kitchenX=garageLeft?x:x+livingW-1;
    const hallZ=1-frontD-hallD+1;
    const volumes:Volume[]=[], envelopes:Envelope[]=[], connections:Connection[]=[];
    const add=(rx:number,rz:number,w:number,d:number,use:RoomUse,floors=stories)=>{
      const v={id:volumes.length,x:rx,z:rz,w,d,use,stories:floors};volumes.push(v);return v;
    };
    const projection=family==='Stepped-front ranch'?int(2,4):0;
    const living=add(livingX,1-frontD,livingW,frontD+projection,'Living room');
    const kitchen=add(kitchenX,1-frontD,kitchenW,frontD,'Kitchen / dining');
    const join=(a:Volume,b:Volume,doorX:number,doorZ:number,side:boolean)=>connections.push({a:a.id,b:b.id,x:doorX,z:doorZ,side});
    if(random()<0.5) {
      const hall=add(x,hallZ,mainW,hallD,'Hallway');
      const bathW=int(5,6), bedW=int(7,8), lastW=mainW-bathW-bedW+2;
      const sizes=random()<0.5?[bedW,bathW,lastW]:[lastW,bathW,bedW];
      let bx=x;
      const back=sizes.map((w,i)=>{const v=add(bx,rear,w,rearD,i===1?'Bathroom':'Bedroom');bx+=w-1;return v;});
      for(const room of [living,kitchen]) join(room,hall,room.x+Math.floor(room.w/2),room.z,false);
      for(const room of back) join(hall,room,room.x+Math.floor(room.w/2),hall.z,false);
    } else {
      // Longitudinal hall with a primary suite on one side and smaller private
      // rooms opposite. It changes room proportions and circulation orientation.
      const boundary=garageLeft?living.x:kitchen.x;
      const hx=boundary-2, hd=rearD+hallD-1;
      const hall=add(hx,rear,5,hd,'Hallway');
      const primary=add(x,rear,hx-x+1,hd,'Bedroom');
      const rightX=hx+4,rightW=x+mainW-rightX;
      const backDepth=Math.floor((hd+1)/2);
      const bath=add(rightX,rear,rightW,backDepth,'Bathroom');
      const bedroom=add(rightX,rear+backDepth-1,rightW,hd-backDepth+1,'Bedroom');
      join(hall,primary,hx,rear+Math.floor(hd/2),true);
      join(hall,bath,rightX,rear+Math.floor(backDepth/2),true);
      join(hall,bedroom,rightX,bedroom.z+Math.floor(bedroom.d/2),true);
      join(hall,living,garageLeft?boundary+1:boundary-1,living.z,false);
      join(hall,kitchen,garageLeft?boundary-1:boundary+1,kitchen.z,false);
    }
    const main:Envelope={x,z:rear,w:mainW,d:mainD,stories,rooms:volumes.map(v=>v.id),ridge:family==='Two-story gable'?'z':'x',roof:'gable'};
    envelopes.push(main);
    if(projection) envelopes.push({x:living.x,z:0,w:living.w,d:projection+1,stories:1,rooms:[living.id],ridge:'z',roof:'gable'});
    const garageW=price==='starter'?int(7,8):int(8,10),garageD=int(8,11);
    const front=family==='Recessed garage ranch'?-int(1,2):int(2,4);
    const gx=garageLeft?x-garageW+1:x+mainW-1,gz=front-garageD+1;
    const garage=add(gx,gz,garageW,garageD,'Garage',1);
    envelopes.push({x:gx,z:gz,w:garageW,d:garageD,stories:1,rooms:[garage.id],ridge:'z',roof:family==='Recessed garage ranch'?'hip':'gable'});
    const sharedX=garageLeft?x:x+mainW-1;
    const sharedMin=Math.max(kitchen.z,garage.z)+1;
    const sharedMax=Math.min(kitchen.z+kitchen.d-1,garage.z+garage.d-1)-1;
    if(sharedMin>sharedMax) continue;
    join(kitchen,garage,sharedX,int(sharedMin,sharedMax),true);
    const entryX=garageLeft?living.x+2:living.x+living.w-3;
    const entry={x:entryX,z:projection};
    const signature=JSON.stringify({family,volumes,connections});
    const plan:HousePlan={family,volumes,envelopes,connections,entry,signature,roofs:[],porchCanopy:family==='Cross-gable entry'||stories===2};
    if(reviewSuburban(plan).accepted) return plan;
  }
  throw new Error('Could not find a coherent suburban composition');
}
