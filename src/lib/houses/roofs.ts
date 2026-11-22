import type { HouseStyle } from './catalog';
import type { Volume, Envelope } from './plan';

export type RoofForm = 'gable' | 'hip' | 'shed' | 'flat' | 'shallow';
export type RoofVolume = {
  x: number; z: number; w: number; d: number; stories: number;
  roof: RoofForm; ridge: 'x' | 'z'; pitch: number; rooms: number[];
};

/** Roof masses are independent of rooms. Adjacent rooms may share a continuous
 * roof only when their union is rectangular; courtyards remain open. */
export function planRoofs(volumes: readonly Volume[], style: HouseStyle, random: () => number, envelopes?: readonly Envelope[]): RoofVolume[] {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random()*items.length)]!;
  const trailer=style==='manufactured', modern=style==='pnw_modern';
  const forms: RoofForm[]=trailer?['shallow']:modern?['flat','shed']:style==='ranch'?['hip','shallow','gable']:['gable','gable','hip'];
  const primary=pick(forms);
  const masses = envelopes ? envelopes.map(e => ({ ...e, rooms: [...e.rooms] })) : volumes.map(v=>({x:v.x,z:v.z,w:v.w,d:v.d,stories:v.stories,rooms:[v.id]}));
  let merged=!envelopes;
  while(merged) {
    merged=false;
    for(let i=0;i<masses.length&&!merged;i++) for(let j=i+1;j<masses.length;j++) {
      const a=masses[i],b=masses[j];
      if(a.stories!==b.stories) continue;
      const sameZ=a.z===b.z&&a.d===b.d&&(a.x+a.w-1===b.x||b.x+b.w-1===a.x);
      const sameX=a.x===b.x&&a.w===b.w&&(a.z+a.d-1===b.z||b.z+b.d-1===a.z);
      if(!sameZ&&!sameX) continue;
      const x=Math.min(a.x,b.x),z=Math.min(a.z,b.z);
      masses[i]={x,z,w:Math.max(a.x+a.w,b.x+b.w)-x,d:Math.max(a.z+a.d,b.z+b.d)-z,stories:a.stories,rooms:[...a.rooms,...b.rooms]};
      masses.splice(j,1);merged=true;break;
    }
  }
  // Use a shared primary pitch to tie the composition together, with occasional
  // shallower secondary roofs and perpendicular ridges on projecting wings.
  const mainPitch=trailer?3:1+Math.floor(random()*2);
  return masses.map((mass,i)=>({
    ...mass,
    roof:envelopes?.[i].roof ?? (i===0||random()<0.7?primary:pick(forms)),
    ridge:envelopes?.[i].ridge ?? (mass.w>mass.d+2?'x':mass.d>mass.w+2?'z':pick(['x','z'] as const)),
    pitch:style==='ranch'?3:style==='suburban'||style==='craftsman'?2:trailer?3:mainPitch+(i>0&&random()<0.25?1:0),
  }));
}
