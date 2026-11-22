import type { HousePrice } from './catalog';
import type { Connection, Envelope, HousePlan, RoomUse, Volume } from './plan';

/** Modern Inland Northwest Craftsman compositions. Choose the public/private
 * arrangement, then partition it; rooms never sprout independent roof masses. */
export function planCraftsman(price:Exclude<HousePrice,'any'>, random:()=>number):HousePlan {
  const int=(a:number,b:number)=>a+Math.floor(random()*(b-a+1));
  const families=['Front-gable bungalow','Broad-porch Craftsman','Rear-wing Craftsman','Two-story Craftsman'] as const;
  const family=families[int(0,3)], stories=family==='Two-story Craftsman'?2:1;
  const volumes:Volume[]=[],envelopes:Envelope[]=[],connections:Connection[]=[];
  const add=(x:number,z:number,w:number,d:number,use:RoomUse,floors=stories)=>{
    const v={id:volumes.length,x,z,w,d,use,stories:floors};volumes.push(v);return v;
  };
  const join=(a:Volume,b:Volume,x:number,z:number,side:boolean)=>connections.push({a:a.id,b:b.id,x,z,side});
  let garage:Volume,porch:NonNullable<HousePlan['porch']>;
  if(family==='Rear-wing Craftsman') {
    // Garage shares the public body's roof; a perpendicular bedroom wing is
    // the only second mass. The front remains a continuous porch elevation.
    const lw=int(10,12),kw=int(8,10),gw=int(8,10),d=int(8,10),pw=lw+kw-1;
    const x=-Math.floor(pw/2),z=1-d;
    const living=add(x,z,lw,d,'Living room'),kitchen=add(x+lw-1,z,kw,d,'Kitchen / dining');
    garage=add(x+pw-1,z,gw,d,'Garage');
    join(living,kitchen,kitchen.x,z+Math.floor(d/2),true);
    join(kitchen,garage,garage.x,z+Math.floor(d/2),true);
    envelopes.push({x,z,w:pw+gw-1,d,stories:1,rooms:[living.id,kitchen.id,garage.id],roof:'gable',ridge:'x'});
    const ww=int(12,14),depths=[int(6,7),5,int(6,7)],wd=depths.reduce((sum,n)=>sum+n-1,1);
    const wx=random()<0.5?x:x+pw-ww,wz=z-wd+1;
    const hall=add(wx,wz,4,wd,'Hallway');
    const doorX=wx+1===kitchen.x?wx+2:wx+1;
    join(doorX>kitchen.x?kitchen:living,hall,doorX,z,false);
    const ids=[hall.id];
    let rz=wz;
    for(const [i,depth] of depths.entries()) {
      const room=add(wx+3,rz,ww-3,depth,i===1?'Bathroom':'Bedroom');
      ids.push(room.id);join(hall,room,room.x,rz+Math.floor(depth/2),true);rz+=depth-1;
    }
    envelopes.push({x:wx,z:wz,w:ww,d:wd,stories:1,rooms:ids,roof:'gable',ridge:'z'});
    porch={x:x+1,z:1,w:pw-2,d:int(3,4),roof:'shed'};
  } else {
    const broad=family==='Broad-porch Craftsman', frontGable=family==='Front-gable bungalow';
    const w=broad?int(23,26):int(19,21),frontD=8,rearD=frontGable?int(9,11):int(6,7),hallD=4;
    const d=frontD+hallD+rearD-2,x=-Math.floor(w/2),z=1-d,left=random()<0.5;
    const lw=int(10,12),kw=w-lw+1;
    const living=add(left?x+w-lw:x,1-frontD,lw,frontD,'Living room');
    const kitchen=add(left?x:x+lw-1,1-frontD,kw,frontD,'Kitchen / dining');
    if(frontGable||!broad&&random()<0.5) {
      // A spine running back from the public rooms serves a generous primary
      // bedroom on one side and two smaller private rooms opposite.
      const boundary=left?living.x:kitchen.x,hx=boundary-2,hd=rearD+hallD-1;
      const hall=add(hx,z,5,hd,'Hallway');
      const primary=add(x,z,hx-x+1,hd,'Bedroom');
      const rx=hx+4,rw=x+w-rx,bd=Math.floor((hd+1)/2);
      const bath=add(rx,z,rw,bd,'Bathroom'),bed=add(rx,z+bd-1,rw,hd-bd+1,'Bedroom');
      join(hall,primary,hx,z+Math.floor(hd/2),true);
      join(hall,bath,rx,z+Math.floor(bd/2),true);
      join(hall,bed,rx,bed.z+Math.floor(bed.d/2),true);
      join(living,hall,left?boundary+1:boundary-1,living.z,false);
      join(kitchen,hall,left?boundary-1:boundary+1,kitchen.z,false);
    } else {
      const hall=add(x,z+rearD-1,w,hallD,'Hallway');
      for(const room of [living,kitchen]) join(room,hall,room.x+Math.floor(room.w/2),room.z,false);
      const bathW=int(5,6),bedW=int(8,10),widths=[bedW,bathW,w-bedW-bathW+2];
      if(random()<0.5) widths.reverse();
      let rx=x;
      for(const [i,rw] of widths.entries()) {
        const room=add(rx,z,rw,rearD,i===1?'Bathroom':'Bedroom');
        join(hall,room,rx+Math.floor(rw/2),hall.z,false);rx+=rw-1;
      }
    }
    envelopes.push({x,z,w,d,stories,rooms:volumes.map(v=>v.id),roof:'gable',ridge:frontGable?'z':'x'});
    const gw=int(8,price==='mid'?9:11),gd=int(9,12);
    const front=family==='Two-story Craftsman'?int(1,3):-int(1,3);
    garage=add(left?x-gw+1:x+w-1,front-gd+1,gw,gd,'Garage',1);
    const lo=Math.max(kitchen.z,garage.z)+1,hi=Math.min(0,front)-1;
    join(kitchen,garage,left?x:x+w-1,int(lo,hi),true);
    envelopes.push({x:garage.x,z:garage.z,w:gw,d:gd,stories:1,rooms:[garage.id],roof:'gable',ridge:'z'});
    porch=broad?{x:x+1,z:1,w:w-2,d:int(3,4),roof:'shed'}:
      {x:living.x+1,z:1,w:living.w-2,d:int(3,4),roof:'gable'};
  }
  const living=volumes[0];
  const entry={x:living.x+Math.floor(living.w/2),z:0};
  // Mirror the entire composition, including roof axes, circulation, porch and
  // garage access. The rear-wing grammar isn't permanently right-handed.
  const garageDoor={x:garage.x+Math.floor(garage.w/2),z:garage.z+garage.d-1,side:false,dx:0,dz:1};
  if(random()<0.5) {
    for(const v of [...volumes,...envelopes]) v.x=-v.x-v.w+1;
    for(const c of connections) c.x=-c.x;
    porch.x=-porch.x-porch.w+1;entry.x=-entry.x;garageDoor.x=-garageDoor.x;
  }
  const plan:HousePlan={family,volumes,envelopes,connections,entry,garageDoor,porch,porchCanopy:true,roofs:[],signature:''};
  plan.signature=JSON.stringify({family,volumes,connections,porch,garageDoor});
  return plan;
}
