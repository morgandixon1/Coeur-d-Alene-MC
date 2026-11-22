"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RegionStatus, TileStatus } from "@/lib/region";

const READS = [
  { swatch: "#8a8f86", name: "Towns", detail: "House and shop footprints packed along the real streets." },
  { swatch: "#e0a12e", name: "Farmland", detail: "The yellow and orange fields north of Post Falls and Coeur d'Alene." },
  { swatch: "#2f6f3a", name: "Forest", detail: "The timbered ground south of the river and around the lake." },
  { swatch: "#2f6ea8", name: "Water", detail: "The Spokane River through town and Coeur d'Alene Lake at the southeast." },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function TileCard({ tile }: { tile: TileStatus }) {
  return (
    <article className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#1c1915]/10 bg-[#fffaf3]/90">
      <div className="relative min-h-28 flex-1 bg-[#d5e2ea]">
        {tile.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/region/preview?tile=${tile.id}`}
            alt={`Top-down map of the ${tile.label} tile`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center px-2 py-6 text-center text-xs text-[#3f3a33]">{tile.line}</div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{tile.label}</p>
          <p className="truncate text-[11px] text-[#6d675e]">
            {tile.bytes ? formatBytes(tile.bytes) : tile.detail}
          </p>
        </div>
        {tile.download ? (
          <Button asChild size="sm">
            <a href={`/api/region/world?tile=${tile.id}`}>Get</a>
          </Button>
        ) : (
          <Badge variant="secondary">{tile.phase === "failed" ? "Stopped" : tile.phase === "running" ? "Building" : "Queued"}</Badge>
        )}
      </div>
    </article>
  );
}

export function RegionStudio() {
  const [status, setStatus] = useState<RegionStatus | null>(null);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function tick() {
      try {
        const response = await fetch("/api/region");
        const next = (await response.json()) as RegionStatus;
        if (stop) return;
        setStatus(next);
        if (next.phase !== "ready") timer = window.setTimeout(tick, 5000);
      } catch {
        if (!stop) timer = window.setTimeout(tick, 6000);
      }
    }
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  const tiles = status?.tiles ?? [];
  const bySpot = (row: number, col: number) => tiles.find((tile) => tile.row === row && tile.col === col);

  return (
    <div className="grid min-h-dvh grid-rows-[minmax(420px,62dvh)_auto] bg-[#f3ecdf] text-[#1c1915] lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
      <section className="relative min-h-[420px] bg-[#c5d4c8] p-3 lg:col-start-2 lg:row-start-1">
        <div className="grid h-full grid-cols-3 grid-rows-3 gap-2">
          {[0, 1, 2].flatMap((row) =>
            [0, 1, 2].map((col) => {
              const tile = bySpot(row, col);
              return tile ? <TileCard key={tile.id} tile={tile} /> : <div key={`${row}-${col}`} className="rounded-xl bg-[#fffaf3]/50" />;
            }),
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-5 overflow-y-auto px-4 py-5 lg:col-start-1 lg:row-start-1 lg:max-h-dvh lg:border-r lg:border-[#e4d8c4] lg:px-5">
        <header>
          <p className="text-xs font-medium tracking-[0.16em] text-[#8a5a32] uppercase">Bedrock world</p>
          <h1 className="font-heading mt-1 text-4xl tracking-tight text-[#234e45]">Inland Northwest</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#4d473f]">
            Coeur d&apos;Alene, the lake, Post Falls, and the Spokane Valley, cut into nine worlds so the houses and
            roads still fit.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">47.704° N</Badge>
          <Badge variant="secondary">116.871° W</Badge>
          <Badge variant="secondary">20 miles out</Badge>
          <Badge variant="secondary">{status ? `${status.readyCount} of 9 ready` : "Starting"}</Badge>
        </div>

        <p className="text-sm leading-relaxed text-[#4d473f]">
          The square runs 20 miles north, south, east, and west of the pin. Coeur d&apos;Alene and Post Falls share the
          center tile. The Spokane Valley is the tile to its west. Downtown Spokane is just past that west edge. The
          lake is the tile south of the center.
        </p>

        <div className="space-y-2">
          <h2 className="font-heading text-lg">How the colors read</h2>
          <ul className="space-y-2">
            {READS.map((item) => (
              <li key={item.name} className="flex gap-2 text-sm">
                <span className="mt-1 size-3.5 shrink-0 rounded-sm border border-[#1c1915]/15" style={{ background: item.swatch }} />
                <span>
                  <span className="font-medium">{item.name}. </span>
                  <span className="text-[#4d473f]">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-[#6d675e]">
            One block is about 3.3 meters. Arnis builds each tile from OpenStreetMap, Overture building heights,
            Mapterhorn elevation, ESA land cover, and a canopy map, then writes Minecraft chunks. This computer has no
            graphics card, so that work runs on the CPU, one tile at a time. Your browser draws the nine maps.
          </p>
        </div>

        <details className="rounded-xl border border-[#e4d8c4] bg-[#fffaf3] px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Open a tile in Minecraft</summary>
          <div className="mt-2 space-y-2 leading-relaxed text-[#4d473f]">
            <p>Each Get button is its own Bedrock world, in creative mode so you can fly. Java Edition cannot open these files. Hills in a tile may need Bedrock 1.21.120 or newer, because the real relief is taller than the old build limit.</p>
            <p>On Windows, double-click the file. On a phone, open it with Minecraft. Import the center tile first, host it, and have friends join from the Friends tab.</p>
            <p>Map data © OpenStreetMap contributors, plus Overture, ESA WorldCover, and the elevation and canopy sets Arnis uses. The Google Maps link was only the center pin.</p>
          </div>
        </details>
      </aside>
    </div>
  );
}
