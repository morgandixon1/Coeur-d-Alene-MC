import { readFileSync } from "node:fs";
import { utmToBlock } from "../../../src/lib/inw/grid.ts";

export type Contour = {
  /** Lake-bed elevation of the line, feet above sea level in the survey datum. */
  elevationFeet: number;
  /** Block-space polyline parts, x then z. */
  parts: Float64Array[];
};

function readDbf(file: string, field: string): number[] {
  const buf = readFileSync(file);
  const count = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  let offset = 1;
  let length = 0;
  for (let at = 32; buf[at] !== 0x0d; at += 32) {
    const name = buf.toString("latin1", at, at + 11).replace(/\0.*$/, "");
    const size = buf[at + 16];
    if (name === field) {
      length = size;
      break;
    }
    offset += size;
  }
  if (!length) throw new Error(`No ${field} column in ${file}`);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = headerLength + i * recordLength + offset;
    values.push(Number.parseFloat(buf.toString("latin1", start, start + length)));
  }
  return values;
}

/** Reads polyline (3) and polylineZ (13) shapes in UTM 11N meters, keeping parts that touch the box. */
export function loadContours(base: string, keep: { x0: number; z0: number; x1: number; z1: number }): Contour[] {
  const elevations = readDbf(`${base}.dbf`, "CONTOUR");
  const shp = readFileSync(`${base}.shp`);
  const contours: Contour[] = [];
  let at = 100;
  let index = 0;
  while (at + 8 <= shp.length) {
    const contentBytes = shp.readInt32BE(at + 4) * 2;
    const body = at + 8;
    const type = shp.readInt32LE(body);
    if (type === 3 || type === 13) {
      const numParts = shp.readInt32LE(body + 36);
      const numPoints = shp.readInt32LE(body + 40);
      const partsAt = body + 44;
      const pointsAt = partsAt + numParts * 4;
      const parts: Float64Array[] = [];
      for (let p = 0; p < numParts; p += 1) {
        const first = shp.readInt32LE(partsAt + p * 4);
        const last = p + 1 < numParts ? shp.readInt32LE(partsAt + (p + 1) * 4) : numPoints;
        const points = new Float64Array((last - first) * 2);
        let inside = false;
        for (let i = first; i < last; i += 1) {
          const block = utmToBlock(shp.readDoubleLE(pointsAt + i * 16), shp.readDoubleLE(pointsAt + i * 16 + 8));
          points[(i - first) * 2] = block.x;
          points[(i - first) * 2 + 1] = block.z;
          if (block.x >= keep.x0 && block.x <= keep.x1 && block.z >= keep.z0 && block.z <= keep.z1) inside = true;
        }
        if (inside) parts.push(points);
      }
      if (parts.length > 0) contours.push({ elevationFeet: elevations[index], parts });
    }
    at = body + contentBytes;
    index += 1;
  }
  return contours;
}
