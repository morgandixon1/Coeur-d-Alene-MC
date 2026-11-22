import type { HouseRequest } from './catalog';
import { generateHouse, type House } from './generate';

/** Keep the user's brief fixed while selecting a structurally varied review set. */
export function generateHouseBatch(request: HouseRequest, count = 6): House[] {
  const start=request.seed ?? Math.floor(Math.random()*0xffffffff);
  const candidates=Array.from({length:count*3},(_,i)=>generateHouse({...request,seed:(start+Math.imul(i,2654435761))>>>0}));
  const selected:House[]=[], used=new Set<string>();
  const families=new Set<string>();
  for(const house of candidates) {
    if(families.has(house.plan.family)) continue;
    families.add(house.plan.family); selected.push(house);
    if(selected.length===count) return selected;
  }
  for(const house of candidates) {
    const main=house.plan.envelopes[0], garage=house.plan.envelopes.at(-1);
    const form=`${house.plan.family}/${main.stories}/${garage && garage.x < main.x ? 'left' : 'right'}`;
    if(used.has(form)||selected.includes(house))continue;
    used.add(form);selected.push(house);
    if(selected.length===count)return selected;
  }
  for(const house of candidates) if(!selected.includes(house)) {
    selected.push(house);if(selected.length===count)break;
  }
  return selected;
}
