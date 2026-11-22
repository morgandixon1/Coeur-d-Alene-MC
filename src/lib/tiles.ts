export type MapTile = {
  id: string;
  label: string;
  detail: string;
  /** North-up row, 0 at the top. */
  row: number;
  col: number;
  bbox: string;
  spawnLat: number;
  spawnLng: number;
};

/** Nine squares covering 20 miles out from 47.70373 N, 116.87055 W. */
export const TILES: MapTile[] = [
  {
    id: "north-west",
    label: "Northwest",
    detail: "North of the Spokane Valley",
    row: 0,
    col: 0,
    bbox: "47.800109,-117.300192,47.992865,-117.013763",
    spawnLat: 47.896487,
    spawnLng: -117.156978,
  },
  {
    id: "north-center",
    label: "North",
    detail: "Prairie north of Rathdrum",
    row: 0,
    col: 1,
    bbox: "47.800109,-117.013763,47.992865,-116.727335",
    spawnLat: 47.896487,
    spawnLng: -116.870549,
  },
  {
    id: "north-east",
    label: "Northeast",
    detail: "North of Hayden",
    row: 0,
    col: 2,
    bbox: "47.800109,-116.727335,47.992865,-116.440906",
    spawnLat: 47.896487,
    spawnLng: -116.58412,
  },
  {
    id: "middle-west",
    label: "Spokane Valley",
    detail: "The valley east of downtown Spokane",
    row: 1,
    col: 0,
    bbox: "47.607352,-117.300192,47.800109,-117.013763",
    spawnLat: 47.703731,
    spawnLng: -117.156978,
  },
  {
    id: "middle-center",
    label: "Post Falls",
    detail: "The center pin, Post Falls, and Coeur d'Alene",
    row: 1,
    col: 1,
    bbox: "47.607352,-117.013763,47.800109,-116.727335",
    spawnLat: 47.7037303,
    spawnLng: -116.8705491,
  },
  {
    id: "middle-east",
    label: "East of the lake",
    detail: "The east shore and the hills beyond",
    row: 1,
    col: 2,
    bbox: "47.607352,-116.727335,47.800109,-116.440906",
    spawnLat: 47.703731,
    spawnLng: -116.58412,
  },
  {
    id: "south-west",
    label: "Southwest",
    detail: "South of the valley",
    row: 2,
    col: 0,
    bbox: "47.414596,-117.300192,47.607352,-117.013763",
    spawnLat: 47.510974,
    spawnLng: -117.156978,
  },
  {
    id: "south-center",
    label: "The lake",
    detail: "Coeur d'Alene Lake",
    row: 2,
    col: 1,
    bbox: "47.414596,-117.013763,47.607352,-116.727335",
    spawnLat: 47.510974,
    spawnLng: -116.870549,
  },
  {
    id: "south-east",
    label: "Southeast",
    detail: "South of the east shore",
    row: 2,
    col: 2,
    bbox: "47.414596,-116.727335,47.607352,-116.440906",
    spawnLat: 47.510974,
    spawnLng: -116.58412,
  },
];

export const TILE_ORDER = [
  "middle-center",
  "middle-west",
  "middle-east",
  "south-center",
  "north-center",
  "north-east",
  "north-west",
  "south-west",
  "south-east",
];

export function tileById(id: string): MapTile | undefined {
  return TILES.find((tile) => tile.id === id);
}
