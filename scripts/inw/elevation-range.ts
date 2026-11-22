/** Prints the lowest bed and highest ground inside the circle, from the 8 m pyramid level. */
import { NODATA, WORLD, insideWorld } from "../../src/lib/inw/grid.ts";
import { minecraftY } from "../../src/lib/inw/height.ts";
import { readTile } from "../../src/lib/inw/store.ts";

const LEVEL = 3;
const SIZE = WORLD.tileSize;
const span = SIZE << LEVEL;
const reach = Math.ceil(WORLD.radiusMeters / span);
let low = { m: Infinity, x: 0, z: 0 };
let high = { m: -Infinity, x: 0, z: 0 };
const histogram = new Map<number, number>();
for (let tz = -reach; tz < reach; tz += 1) {
  for (let tx = -reach; tx < reach; tx += 1) {
    const tile = await readTile("view", LEVEL, tx, tz, 1);
    if (!tile) continue;
    const ground = tile[0];
    for (let i = 0; i < ground.length; i += 1) {
      if (ground[i] === NODATA) continue;
      const x = tx * span + (i % SIZE) * (1 << LEVEL);
      const z = tz * span + Math.floor(i / SIZE) * (1 << LEVEL);
      if (!insideWorld(x, z)) continue;
      const m = ground[i] / 10;
      if (m < low.m) low = { m, x, z };
      if (m > high.m) high = { m, x, z };
      const band = Math.floor(m / 50) * 50;
      histogram.set(band, (histogram.get(band) ?? 0) + 1);
    }
  }
}
console.log("lowest", low, "y", minecraftY(low.m));
console.log("highest", high, "y", minecraftY(high.m));
const total = [...histogram.values()].reduce((a, b) => a + b, 0);
for (const [band, count] of [...histogram].sort((a, b) => a[0] - b[0])) {
  console.log(`${band}-${band + 50} m  ${((count / total) * 100).toFixed(1)}%  y ${minecraftY(band)}..${minecraftY(band + 50)}`);
}
