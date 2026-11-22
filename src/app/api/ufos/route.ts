import { packVoxelWorld } from "@/lib/pack-voxel-world";
import { civilizationFor, UFO_CIVILIZATIONS, UFO_CONDITIONS, UFO_HULLS, type UfoHull, type UfoRequest } from "@/lib/ufos/catalog";
import { generateUfo } from "@/lib/ufos/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Send a UFO configuration as JSON." }, { status: 400 });
  }

  const { civilization, hull = "any", condition = "any", seed } = raw as Record<string, unknown>;
  if ((civilization !== undefined && (typeof civilization !== "string" || !Object.hasOwn(UFO_CIVILIZATIONS, civilization))) ||
      typeof hull !== "string" || (hull !== "any" && !Object.hasOwn(UFO_HULLS, hull)) ||
      typeof condition !== "string" || (condition !== "any" && !Object.hasOwn(UFO_CONDITIONS, condition)) ||
      (seed !== undefined && (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff))) {
    return Response.json({ error: "Choose a valid civilization, hull, condition, and optional seed from 0 to 4294967295." }, { status: 400 });
  }

  if (civilization !== undefined && hull !== "any" && civilizationFor(hull as UfoHull) !== civilization) {
    return Response.json({ error: "Choose a hull that belongs to the selected civilization." }, { status: 400 });
  }

  try {
    const ufo = generateUfo({ civilization, hull, condition, seed } as UfoRequest);
    const bytes = await packVoxelWorld(ufo);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="ufo-${ufo.hull}-${ufo.condition}-${ufo.seed}.mcworld"`,
        "Cache-Control": "no-store",
        "X-Ufo-Seed": String(ufo.seed),
      },
    });
  } catch (error) {
    console.error("UFO export failed", error);
    return Response.json({ error: "Could not build that UFO world." }, { status: 500 });
  }
}
