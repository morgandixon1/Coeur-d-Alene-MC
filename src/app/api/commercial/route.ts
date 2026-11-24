import { BLOCKS, type BlockId } from "@/lib/blocks";
import {
  COMMERCIAL_ERAS,
  COMMERCIAL_SCALES,
  COMMERCIAL_STORE_TYPES,
  COMMERCIAL_TYPES,
  supportsScale,
  type CommercialEra,
  type CommercialMaterialOverrides,
  type CommercialScale,
  type CommercialStoreType,
  type CommercialType,
} from "@/lib/commercial/catalog";
import { generateCommercial } from "@/lib/commercial/generate";
import { packCommercial } from "@/lib/commercial/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Send a commercial building configuration as JSON." }, { status: 400 });
  }
  const { type = "any", era = "any", scale = "any", storeType = "any", seed, materials } = raw as Record<string, unknown>;
  if (
    typeof type !== "string" ||
    !Object.hasOwn(COMMERCIAL_TYPES, type) ||
    typeof era !== "string" ||
    !Object.hasOwn(COMMERCIAL_ERAS, era) ||
    typeof scale !== "string" ||
    !Object.hasOwn(COMMERCIAL_SCALES, scale) ||
    typeof storeType !== "string" ||
    !Object.hasOwn(COMMERCIAL_STORE_TYPES, storeType) ||
    (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff))
  ) {
    return Response.json(
      { error: "Choose a valid building type, store type, era, scale, and optional seed from 0 to 4294967295." },
      { status: 400 },
    );
  }
  let parsedMaterials: CommercialMaterialOverrides | undefined;
  if (materials && typeof materials === "object" && !Array.isArray(materials)) {
    const m = materials as Record<string, unknown>;
    const valid = (v: unknown): BlockId | undefined =>
      typeof v === "number" && Number.isInteger(v) && Object.hasOwn(BLOCKS, v) ? (v as BlockId) : undefined;
    parsedMaterials = { wall: valid(m.wall), accent: valid(m.accent), trim: valid(m.trim), roof: valid(m.roof) };
  }
  const filters = {
    type: type as CommercialType,
    era: era as CommercialEra,
    scale: scale as CommercialScale,
    storeType: storeType as CommercialStoreType,
    seed: seed as number | undefined,
    materials: parsedMaterials,
  };
  if (!supportsScale(filters.type, filters.scale)) {
    return Response.json({ error: "That commercial building type is unavailable at the selected scale." }, { status: 400 });
  }
  try {
    const building = generateCommercial(filters);
    const bytes = await packCommercial(building);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="commercial-${building.seed}.mcworld"`,
        "Cache-Control": "no-store",
        "X-Commercial-Title": encodeURIComponent(building.title),
        "X-Commercial-Seed": String(building.seed),
      },
    });
  } catch (error) {
    console.error("Commercial export failed", error);
    return Response.json({ error: "Could not build that commercial world." }, { status: 500 });
  }
}
