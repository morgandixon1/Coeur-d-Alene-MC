import { buildRegionMcworld, MAX_API_SIZE, SIZE_CHOICES } from "@/lib/inw/region-world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    x?: unknown;
    z?: unknown;
    size?: unknown;
    name?: unknown;
  } | null;
  const centerX = typeof body?.x === "number" ? body.x : Number(body?.x);
  const centerZ = typeof body?.z === "number" ? body.z : Number(body?.z);
  const size = typeof body?.size === "number" ? body.size : Number(body?.size);
  const name = typeof body?.name === "string" ? body.name : undefined;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) {
    return Response.json({ error: "Need a map center." }, { status: 400 });
  }
  if (!SIZE_CHOICES.includes(size as (typeof SIZE_CHOICES)[number]) || size > MAX_API_SIZE) {
    return Response.json({ error: `Size must be one of ${SIZE_CHOICES.join(", ")}.` }, { status: 400 });
  }
  try {
    const built = await buildRegionMcworld({
      x0: Math.floor(centerX - size / 2),
      z0: Math.floor(centerZ - size / 2),
      size,
      name,
    });
    return new Response(Buffer.from(built.bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${built.fileName}"`,
        "Cache-Control": "no-store",
        "X-Spawn": `${built.spawn.x},${built.spawn.y},${built.spawn.z}`,
        "X-Columns": String(built.columns),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build that region.";
    return Response.json({ error: message }, { status: 500 });
  }
}
