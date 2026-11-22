import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { regionPreview } from "@/lib/region";
import { tileById } from "@/lib/tiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tile = new URL(request.url).searchParams.get("tile") ?? "";
  if (!tileById(tile)) return Response.json({ error: "Unknown map tile." }, { status: 400 });
  const file = await regionPreview(tile);
  if (!file) return Response.json({ error: "That tile is not ready yet." }, { status: 404 });
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
