import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ORIGIN, WORLD, fromUtm, toUtm } from "../../src/lib/inw/grid.ts";
import { SOURCES_DIR } from "../../src/lib/inw/store.ts";

import { PROJECT_ORDER } from "./lidar-order.ts";

type Item = { title: string; downloadURL: string; sizeInBytes: number };

const catalog = JSON.parse(await readFile(path.join(SOURCES_DIR, "tnm-1m.json"), "utf8")) as { items: Item[] };
const corner = toUtm(47.67331341400006, -116.86701096299998);
const back = fromUtm(corner.e, corner.n);
console.log("x51y528 north-west corner", corner, "round trip", back);
console.log("origin", ORIGIN);

const wanted: { cell: string; project: string; url: string; bytes: number; file: string }[] = [];
for (const item of catalog.items) {
  const match = item.title.match(/x(\d+)y(\d+)\s+(\S+)$/);
  if (!match) continue;
  const [, cx, cy, project] = match;
  const west = Number(cx) * 10000;
  const north = Number(cy) * 10000;
  const nearE = Math.max(west, Math.min(ORIGIN.e, west + 10000));
  const nearN = Math.max(north - 10000, Math.min(ORIGIN.n, north));
  if (Math.hypot(nearE - ORIGIN.e, nearN - ORIGIN.n) > WORLD.radiusMeters) continue;
  wanted.push({ cell: `x${cx}y${cy}`, project, url: item.downloadURL, bytes: item.sizeInBytes, file: path.basename(item.downloadURL) });
}
wanted.sort((a, b) => a.cell.localeCompare(b.cell) || PROJECT_ORDER.indexOf(a.project) - PROJECT_ORDER.indexOf(b.project));
await writeFile(path.join(SOURCES_DIR, "lidar-files.json"), JSON.stringify(wanted, null, 1));
await writeFile(path.join(SOURCES_DIR, "lidar-urls.txt"), wanted.map((entry) => entry.url).join("\n") + "\n");
console.log(wanted.length, "files,", new Set(wanted.map((entry) => entry.cell)).size, "cells,", (wanted.reduce((sum, entry) => sum + entry.bytes, 0) / 1e9).toFixed(1), "GB");
