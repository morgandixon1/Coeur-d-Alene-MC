import { readRegionStatus } from "@/lib/region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readRegionStatus();
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
