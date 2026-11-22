import { readFile } from "node:fs/promises";
import path from "node:path";
import { ORIGIN, WORLD } from "@/lib/inw/grid";
import { HEIGHT } from "@/lib/inw/height";
import { WORLD_DIR } from "@/lib/inw/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const water = await readFile(path.join(WORLD_DIR, "water", "features.json"), "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
  return Response.json({ world: WORLD, origin: ORIGIN, height: HEIGHT, water });
}
