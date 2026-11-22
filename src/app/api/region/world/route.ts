import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { regionFile } from "@/lib/region";
import { tileById } from "@/lib/tiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tile = new URL(request.url).searchParams.get("tile") ?? "";
  const known = tileById(tile);
  if (!known) return Response.json({ error: "Unknown map tile." }, { status: 400 });
  const file = await regionFile(tile, ".mcworld");
  if (!file) return Response.json({ error: "That tile is not ready yet." }, { status: 404 });
  const info = await stat(file);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${tile}.mcworld"`,
      "Cache-Control": "no-store",
    },
  });
}
