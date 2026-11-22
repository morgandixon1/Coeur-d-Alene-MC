import { WORLD } from "@/lib/inw/grid";
import { readTileBytes } from "@/lib/inw/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The zlib-deflated view tile as stored. The client inflates it; Next.js drops Content-Encoding headers. */
export async function GET(_request: Request, context: { params: Promise<{ level: string; tx: string; tz: string }> }) {
  const params = await context.params;
  const level = Number(params.level);
  const tx = Number(params.tx);
  const tz = Number(params.tz);
  if (![level, tx, tz].every(Number.isInteger) || level < 0 || level >= WORLD.levels || Math.abs(tx) > 4096 || Math.abs(tz) > 4096) {
    return new Response(null, { status: 400 });
  }
  const bytes = await readTileBytes("view", level, tx, tz);
  if (!bytes) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zlib",
      "Cache-Control": "no-cache",
    },
  });
}
