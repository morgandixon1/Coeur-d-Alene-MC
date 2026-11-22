import { buildMcworld } from "@/lib/mcworld";
import { fileNameFor, parseSettings, SettingsError } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "That request was not valid JSON." }, { status: 400 });
  }

  try {
    const settings = parseSettings(body);
    const file = await buildMcworld(settings);
    return new Response(Buffer.from(file), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileNameFor(settings.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SettingsError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("mcworld export failed", error);
    return Response.json(
      { error: "The world could not be packed. Try again, or pick a smaller size." },
      { status: 500 },
    );
  }
}
