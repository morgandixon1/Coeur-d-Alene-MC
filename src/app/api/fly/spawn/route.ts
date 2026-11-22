import { worldSpawn } from "@/lib/fly-world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("world") ?? "";
  if (!/^[\w .'-]+$/.test(id)) return Response.json({ error: "Unknown world." }, { status: 400 });
  try {
    const world = await worldSpawn(id);
    return Response.json(world);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open that world.";
    return Response.json({ error: message }, { status: 404 });
  }
}
