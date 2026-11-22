import { listWorlds } from "@/lib/fly-world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const worlds = await listWorlds();
  return Response.json({ worlds });
}
