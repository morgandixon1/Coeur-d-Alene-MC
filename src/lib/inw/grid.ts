/**
 * The combined Inland Northwest world. One block is one meter of NAD83 / UTM zone 11N, which is
 * the grid the USGS one-meter lidar is published on, so a lidar pixel is exactly one block.
 * Block x grows east and block z grows south, as in Minecraft.
 */
export const WORLD = {
  name: "Inland Northwest",
  originLabel: "Downtown Coeur d'Alene, Sherman Ave and 4th St",
  originLatLon: { lat: 47.6777, lon: -116.7804 },
  radiusMiles: 12.5,
  /** 12.5 miles, in metres. One metre is one block. */
  radiusMeters: 20117,
  tileSize: 512,
  /** Pyramid level L tiles cover tileSize << L blocks, sampled every 1 << L blocks. */
  levels: 8,
} as const;

export const NODATA = -32768;

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const LON0 = (-117 * Math.PI) / 180;

export function toUtm(lat: number, lon: number): { e: number; n: number } {
  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const t = tan * tan;
  const c = EP2 * cos * cos;
  const a = cos * ((lon * Math.PI) / 180 - LON0);
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const m =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const easting =
    K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  const northing =
    K0 *
    (m +
      n *
        tan *
        ((a * a) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return { e: easting, n: northing };
}

export function fromUtm(e: number, n: number): { lat: number; lon: number } {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const mu = n / K0 / (A * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const c1 = EP2 * cos * cos;
  const t1 = tan * tan;
  const n1 = A / Math.sqrt(1 - E2 * sin * sin);
  const r1 = (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5;
  const d = (e - 500000) / (n1 * K0);
  const phi =
    phi1 -
    ((n1 * tan) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    LON0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / cos;
  return { lat: (phi * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

const originUtm = toUtm(WORLD.originLatLon.lat, WORLD.originLatLon.lon);
/** UTM easting and northing of the north-west corner of block (0, 0). */
export const ORIGIN = { e: Math.round(originUtm.e), n: Math.round(originUtm.n) };

export function blockToUtm(x: number, z: number): { e: number; n: number } {
  return { e: ORIGIN.e + x, n: ORIGIN.n - z };
}

export function utmToBlock(e: number, n: number): { x: number; z: number } {
  return { x: e - ORIGIN.e, z: ORIGIN.n - n };
}

export function insideWorld(x: number, z: number): boolean {
  return x * x + z * z <= WORLD.radiusMeters * WORLD.radiusMeters;
}

/** Level-0 tiles whose square touches the circle. */
export function worldTiles(): { tx: number; tz: number }[] {
  const size = WORLD.tileSize;
  const reach = Math.ceil(WORLD.radiusMeters / size);
  const tiles: { tx: number; tz: number }[] = [];
  for (let tz = -reach; tz < reach; tz += 1) {
    for (let tx = -reach; tx < reach; tx += 1) {
      const nearX = Math.max(tx * size, Math.min(0, (tx + 1) * size - 1));
      const nearZ = Math.max(tz * size, Math.min(0, (tz + 1) * size - 1));
      if (insideWorld(nearX, nearZ)) tiles.push({ tx, tz });
    }
  }
  return tiles;
}