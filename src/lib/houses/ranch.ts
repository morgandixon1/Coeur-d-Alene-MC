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
    const wingW=int(10,12), segments=[int(5,6),5,int(5,6)], wingD=segments.reduce((a,b)=>a+b-1,1);
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
    const w=int(24,28), frontD=int(6,7), rearD=int(5,6), hallD=4,d=frontD+rearD+hallD-2;
    const x=-Math.floor(w/2),z=1-d;
    const livingW=int(9,11),kitchenW=int(7,9),extraW=w-livingW-kitchenW+2;
    const living=add(x,1-frontD,livingW,frontD,'Living room');
    const kitchen=add(x+livingW-1,1-frontD,kitchenW,frontD,'Kitchen / dining');
    const study=add(kitchen.x+kitchen.w-1,1-frontD,extraW,frontD,price==='upscale'?'Study':'Bedroom');
    const hall=add(x,z+rearD-1,w,hallD,'Hallway');
    for(const room of [living,kitchen,study]) join(room,hall,room.x+Math.floor(room.w/2),room.z,false);
    const bathW=int(5,6),bedW=int(8,10),widths=random()<0.5?[bedW,bathW,w-bedW-bathW+2]:[w-bedW-bathW+2,bathW,bedW];
    let rx=x;
    for(const [i,rw] of widths.entries()) {
      const room=add(rx,z,rw,rearD,i===1?'Bathroom':'Bedroom');
      join(room,hall,rx+Math.floor(rw/2),hall.z,false);rx+=rw-1;
    }
    const main:Envelope={x,z,w,d,stories:1,rooms:volumes.map(v=>v.id),roof:family==='Long hip-roof ranch'?'hip':'shallow',ridge:'x'};
    envelopes.push(main);
    const gw=int(7,price==='starter'?8:10);
    garageSide=random()<0.5?'left':'right';
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
    const parent=garageSide==='left'?living:study;
    // Side-entry homes connect to the public end, never through a bedroom.
    if(parent.use==='Bedroom') parent.use='Study';
    const lo=Math.max(parent.z,garage.z)+1,hi=Math.min(parent.z+parent.d-1,garage.z+garage.d-1)-1;
    join(parent,garage,sharedX,int(lo,hi),true);
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
