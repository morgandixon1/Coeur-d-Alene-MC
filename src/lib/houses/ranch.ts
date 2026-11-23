import type { HousePrice } from './catalog';
import type { Connection, Envelope, HousePlan, RoomUse, Volume } from './plan';

/** Single-story compositions: long low roof, integrated or subordinate garage,
 * and bedroom zones reached from halls rather than from other bedrooms. */
export function planRanch(price: Exclude<HousePrice,'any'>, random:()=>number):HousePlan {
  const int=(a:number,b:number)=>a+Math.floor(random()*(b-a+1));
  const families=['Long hip-roof ranch','Recessed-garage ranch','Side-entry ranch','L-shaped bedroom wing'] as const;
  const family=families[int(0,families.length-1)];
  const volumes:Volume[]=[],envelopes:Envelope[]=[],connections:Connection[]=[];
  const add=(x:number,z:number,w:number,d:number,use:RoomUse)=>{
    const v={id:volumes.length,x,z,w,d,use,stories:1};volumes.push(v);return v;
  };
  const join=(a:Volume,b:Volume,x:number,z:number,side:boolean)=>connections.push({a:a.id,b:b.id,x,z,side});
  let garage:Volume|undefined;
  let garageSide: 'left'|'right'='right';
  if(family==='L-shaped bedroom wing') {
    const livingW=int(9,11), kitchenW=int(7,9), publicW=livingW+kitchenW-1;
    const coreD=int(7,9), x=-Math.floor(publicW/2), z=1-coreD;
    const living=add(x,z,livingW,coreD,'Living room');
    const kitchen=add(x+livingW-1,z,kitchenW,coreD,'Kitchen / dining');
    join(living,kitchen,kitchen.x,z+Math.floor(coreD/2),true);
    let coreW=publicW;
    if(price!=='starter'||random()<0.35) {
      garage=add(x+publicW-1,z,int(7,9),coreD,'Garage');
      join(kitchen,garage,garage.x,z+Math.floor(coreD/2),true);
      coreW+=garage.w-1;
    }
    envelopes.push({x,z,w:coreW,d:coreD,stories:1,rooms:volumes.map(v=>v.id),roof:'shallow',ridge:'x'});
    const wingW=int(10,12), segments=[int(6,7),5,int(6,7)], wingD=segments.reduce((a,b)=>a+b-1,1);
    const left=random()<0.5, wx=left?x:x+publicW-wingW, wz=z-wingD+1;
    const hx=left?wx+wingW-4:wx;
    const hall=add(hx,wz,4,wingD,'Hallway');
    const doorX=hx+1===kitchen.x?hx+2:hx+1;
    const parent=doorX>kitchen.x?kitchen:living;
    join(parent,hall,doorX,z,false);
    const roomX=left?wx:wx+3, roomW=wingW-3;
    let rz=wz;
    const ids=[hall.id];
    for(const [i,depth] of segments.entries()) {
      const room=add(roomX,rz,roomW,depth,i===1?'Bathroom':'Bedroom');
      ids.push(room.id);join(hall,room,left?hx:roomX,rz+Math.floor(depth/2),true);rz+=depth-1;
    }
    envelopes.push({x:wx,z:wz,w:wingW,d:wingD,stories:1,rooms:ids,roof:'gable',ridge:'z'});
  } else {
    // Zone the main body into a public living/kitchen side (next to the garage)
    // and a compact private bedroom/bath wing served by a short hallway.
    const pubW=int(10,12), privW=int(13,16), w=pubW+privW-1;
    const frontD=int(6,7), rearD=int(6,7), hallD=4, d=frontD+rearD+hallD-2;
    const livD=frontD+hallD-1, kitD=d-livD+1;
    const x=-Math.floor(w/2), z=1-d;
    garageSide=random()<0.5?'left':'right';
    const pubX=garageSide==='left'?x:x+privW-1;
    const privX=garageSide==='left'?x+pubW-1:x;
    const living=add(pubX,1-livD,pubW,livD,'Living room');
    const kitchen=add(pubX,z,pubW,kitD,'Kitchen / dining');
    join(living,kitchen,pubX+Math.floor(pubW/2),living.z,false);
    const hall=add(privX,z+rearD-1,privW,hallD,'Hallway');
    const splitX=garageSide==='left'?privX:pubX;
    join(living,hall,splitX,hall.z+1+int(0,1),true);
    const bathW=int(5,6), bedW=privW-bathW+1;
    const rearRooms=random()<0.5
      ? [{x:privX,w:bedW,use:'Bedroom' as const},{x:privX+bedW-1,w:bathW,use:'Bathroom' as const}]
      : [{x:privX,w:bathW,use:'Bathroom' as const},{x:privX+bathW-1,w:bedW,use:'Bedroom' as const}];
    for(const spec of rearRooms) {
      const room=add(spec.x,z,spec.w,rearD,spec.use);
      join(room,hall,room.x+Math.floor(room.w/2),hall.z,false);
    }
    if(price==='upscale') {
      const frontBedW=Math.ceil((privW+1)/2), studyW=privW-frontBedW+1;
      const frontBed=add(privX,1-frontD,frontBedW,frontD,'Bedroom');
      const study=add(privX+frontBedW-1,1-frontD,studyW,frontD,'Study');
      join(frontBed,hall,frontBed.x+Math.floor(frontBed.w/2),frontBed.z,false);
      join(study,hall,study.x+Math.floor(study.w/2),study.z,false);
    } else {
      const frontBed=add(privX,1-frontD,privW,frontD,'Bedroom');
      join(frontBed,hall,frontBed.x+Math.floor(frontBed.w/2),frontBed.z,false);
    }
    const main:Envelope={x,z,w,d,stories:1,rooms:volumes.map(v=>v.id),roof:family==='Long hip-roof ranch'?'hip':'shallow',ridge:'x'};
    envelopes.push(main);
    const gw=int(7,price==='starter'?8:10);
    const gx=garageSide==='left'?x-gw+1:x+w-1;
    if(family==='Long hip-roof ranch') {
      garage=add(gx,z,gw,d,'Garage');
      main.x=Math.min(x,gx);main.w+=gw-1;main.rooms.push(garage.id);
    } else {
      const gd=int(8,10), front=family==='Recessed-garage ranch'?-int(1,2):int(0,2);
      garage=add(gx,front-gd+1,gw,gd,'Garage');
      envelopes.push({x:gx,z:garage.z,w:gw,d:gd,stories:1,rooms:[garage.id],roof:'hip',ridge:'z'});
    }
    const sharedX=garageSide==='left'?x:x+w-1;
    const kitLo=Math.max(kitchen.z,garage.z)+1, kitHi=Math.min(kitchen.z+kitchen.d-1,garage.z+garage.d-1)-1;
    const livLo=Math.max(living.z,garage.z)+1, livHi=Math.min(living.z+living.d-1,garage.z+garage.d-1)-1;
    if(kitHi>=kitLo) join(kitchen,garage,sharedX,int(kitLo,kitHi),true);
    else join(living,garage,sharedX,int(livLo,livHi),true);
  }
  const living=volumes[0];
  const entry={x:int(living.x+2,living.x+living.w-3),z:0};
  let garageDoor:HousePlan['garageDoor'];
  if(garage) {
    const side=family==='Side-entry ranch';
    garageDoor=side
      ? {x:garageSide==='left'?garage.x:garage.x+garage.w-1,z:garage.z+Math.floor(garage.d/2),side:true,dx:garageSide==='left'?-1:1,dz:0}
      : {x:garage.x+Math.floor(garage.w/2),z:garage.z+garage.d-1,side:false,dx:0,dz:1};
  }
  return {family,volumes,envelopes,connections,entry,garageDoor,signature:JSON.stringify({family,volumes,connections,garageDoor}),roofs:[],porchCanopy:false};
}
