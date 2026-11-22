import { meshChunks, readChunkList } from "@/lib/fly-world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { world?: unknown; chunks?: unknown } | null;
  const world = body?.world;
  if (typeof world !== "string" || !/^[\w .'-]+$/.test(world)) {
    return Response.json({ error: "Unknown world." }, { status: 400 });
  }
  const chunks = readChunkList(body?.chunks, 8);
  if (!chunks) return Response.json({ error: "Missing chunks." }, { status: 400 });
  try {
    const bytes = await meshChunks(world, chunks);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read those chunks.";
    return Response.json({ error: message }, { status: 500 });
  }
}
