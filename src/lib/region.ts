import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { TILES, type MapTile } from "@/lib/tiles";

const execFileAsync = promisify(execFile);

export const REGION = {
  name: "Inland Northwest",
  center: { lat: 47.7037303, lng: -116.8705491 },
  radiusMiles: 20,
  scale: 0.3,
  metersPerBlock: 1 / 0.3,
  directory: path.join(process.cwd(), "data", "inland-northwest", "tiles"),
} as const;

export type TilePhase = "waiting" | "running" | "ready" | "failed";

export type TileStatus = {
  id: string;
  label: string;
  detail: string;
  row: number;
  col: number;
  phase: TilePhase;
  line: string;
  preview: boolean;
  download: boolean;
  bytes: number | null;
};

export type RegionStatus = {
  phase: "running" | "ready" | "failed" | "waiting";
  readyCount: number;
  tiles: TileStatus[];
};

function usefulLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("██") && !/^[▄█▀▌\s]+$/.test(line));
}

async function tileStatus(tile: MapTile): Promise<TileStatus> {
  const directory = path.join(REGION.directory, tile.id);
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    names = [];
  }
  const world = names.find((name) => name.endsWith(".mcworld")) ?? null;
  const preview = names.some((name) => name.endsWith(".png"));
  let logText = "";
  try {
    logText = await readFile(path.join(directory, "generate.log"), "utf8");
  } catch {
    logText = "";
  }
  const lines = usefulLines(logText);
  const exit = lines.find((line) => line.startsWith("EXIT:"));
  const line = [...lines].reverse().find((entry) => !entry.startsWith("EXIT:")) ?? "Waiting in the queue.";
  let phase: TilePhase = "waiting";
  if (exit === "EXIT:0" && world) phase = "ready";
  else if (exit && exit !== "EXIT:0") phase = "failed";
  else if (logText) phase = "running";
  let bytes: number | null = null;
  if (world && phase === "ready") {
    bytes = (await stat(path.join(directory, world))).size;
  }
  return {
    id: tile.id,
    label: tile.label,
    detail: tile.detail,
    row: tile.row,
    col: tile.col,
    phase,
    line,
    preview: phase === "ready" && preview,
    download: phase === "ready",
    bytes,
  };
}

export async function readRegionStatus(): Promise<RegionStatus> {
  const tiles = await Promise.all(TILES.map((tile) => tileStatus(tile)));
  const readyCount = tiles.filter((tile) => tile.phase === "ready").length;
  const failed = tiles.some((tile) => tile.phase === "failed");
  const running = tiles.some((tile) => tile.phase === "running");
  const phase = readyCount === tiles.length ? "ready" : failed && !running ? "failed" : running || readyCount > 0 ? "running" : "waiting";
  return { phase, readyCount, tiles };
}

export async function regionPreview(tileId: string): Promise<string | null> {
  const png = await regionFile(tileId, ".png");
  if (!png) return null;
  const jpeg = png.replace(/\.png$/i, ".web.jpg");
  try {
    const info = await stat(jpeg);
    if (info.size > 0) return jpeg;
  } catch {
    // The small copy is created once, next to the full map.
  }
  await execFileAsync("ffmpeg", ["-y", "-i", png, "-vf", "scale=1400:-1", "-q:v", "3", jpeg]);
  return jpeg;
}

export async function regionFile(tileId: string, extension: ".png" | ".mcworld"): Promise<string | null> {
  const tile = TILES.find((entry) => entry.id === tileId);
  if (!tile) return null;
  const directory = path.join(REGION.directory, tile.id);
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    return null;
  }
  const name = names.find((entry) => entry.endsWith(extension));
  return name ? path.join(directory, name) : null;
}
