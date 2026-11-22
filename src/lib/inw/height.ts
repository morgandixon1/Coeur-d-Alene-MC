/**
 * Real elevation (meters above sea level) to Minecraft y.
 *
 * Bedrock builds from y -64 to 319, 384 blocks, but this circle spans about 1140 m, from the Spokane
 * River bed (~581 m) to the peak 27 km north-east of downtown (1726.5 m). Everything below kneeM, which
 * holds the valley floors, the lakes, and the towns (about half the land), stays at true 1:1 height.
 * Above it the slope eases over about blendM of elevation down to aboveSlope, chosen so that peak lands
 * on maxY, and hills keep their shape at a gentler grade.
 */
export const HEIGHT = {
  /** Elevation that lands on y = 0. */
  zeroM: 642,
  kneeM: 760,
  blendM: 40,
  aboveSlope: 0.1727,
  minY: -63,
  maxY: 318,
} as const;

export function minecraftY(meters: number): number {
  const { zeroM, kneeM, blendM, aboveSlope, minY, maxY } = HEIGHT;
  let y: number;
  if (meters <= kneeM) {
    y = meters - zeroM;
  } else {
    const over = meters - kneeM;
    y = kneeM - zeroM + aboveSlope * over + (1 - aboveSlope) * blendM * (1 - Math.exp(-over / blendM));
  }
  return Math.max(minY, Math.min(maxY, Math.round(y)));
}
