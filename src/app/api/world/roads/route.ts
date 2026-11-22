import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORLD_DIR } from "@/lib/inw/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bytes = await readFile(path.join(WORLD_DIR, "roads.bin"));
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}
