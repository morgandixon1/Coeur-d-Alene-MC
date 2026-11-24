import type { CommercialRequest } from "./catalog";
import { generateCommercial, type CommercialBuilding } from "./generate";

/** Keep the user's brief fixed while selecting a structurally varied review set. */
export function generateCommercialBatch(request: CommercialRequest, count = 6): CommercialBuilding[] {
  const start = request.seed ?? Math.floor(Math.random() * 0xffffffff);
  const candidates = Array.from({ length: count * 3 }, (_, i) =>
    generateCommercial({ ...request, seed: (start + Math.imul(i, 2654435761)) >>> 0 }),
  );
  const selected: CommercialBuilding[] = [];
  const usedForms = new Set<string>();

  for (const building of candidates) {
    const key = `${building.type}/${building.plan.family}`;
    if (usedForms.has(key)) continue;
    usedForms.add(key);
    selected.push(building);
    if (selected.length === count) return selected;
  }

  for (const building of candidates) {
    if (selected.includes(building)) continue;
    const key = `${building.type}/${building.era}/${building.plan.envelopes[0]?.roof ?? "parapet"}`;
    if (usedForms.has(key)) continue;
    usedForms.add(key);
    selected.push(building);
    if (selected.length === count) return selected;
  }

  for (const building of candidates) {
    if (!selected.includes(building)) {
      selected.push(building);
      if (selected.length === count) break;
    }
  }
  return selected;
}
