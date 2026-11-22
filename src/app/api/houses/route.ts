import { HOUSE_ERAS, HOUSE_PRICES, HOUSE_STYLES, supportsTier, type HouseEra, type HousePrice, type HouseStyle } from "@/lib/houses/catalog";
import { generateHouse } from "@/lib/houses/generate";
import { packHouse } from "@/lib/houses/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Send a house configuration as JSON." }, { status: 400 });
  }
  const { style = "any", era = "any", price = "any", seed } = raw as Record<string, unknown>;
  if (typeof style !== "string" || !Object.hasOwn(HOUSE_STYLES, style) ||
      typeof era !== "string" || !Object.hasOwn(HOUSE_ERAS, era) ||
      typeof price !== "string" || !Object.hasOwn(HOUSE_PRICES, price) ||
      (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff))) {
    return Response.json({ error: "Choose a valid style, era, tier, and optional seed from 0 to 4294967295." }, { status: 400 });
  }
  const filters = { style: style as HouseStyle, era: era as HouseEra, price: price as HousePrice, seed: seed as number | undefined };
  if (!supportsTier(filters.style, filters.price)) {
    return Response.json({ error: "That home style is unavailable at the selected tier." }, { status: 400 });
  }
  try {
    const house = generateHouse(filters);
    const bytes = await packHouse(house);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="house-${house.seed}.mcworld"`,
        "Cache-Control": "no-store",
        "X-House-Title": encodeURIComponent(house.title),
        "X-House-Seed": String(house.seed),
      },
    });
  } catch (error) {
    console.error("House export failed", error);
    return Response.json({ error: "Could not build that house world." }, { status: 500 });
  }
}
