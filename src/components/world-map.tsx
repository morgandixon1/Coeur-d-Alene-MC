"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BLOCKS, Block } from "@/lib/blocks";
import { NODATA, WORLD, blockToUtm, fromUtm } from "@/lib/inw/grid";
import { minecraftY } from "@/lib/inw/height";
import { ROAD_RGB, decodeRoads, rasterRoads, type Road } from "@/lib/inw/roads";
import { SIZE_CHOICES } from "@/lib/inw/region";

const SIZE = WORLD.tileSize;
const MAX_LEVEL = WORLD.levels - 1;
const CACHE_LIMIT = 110;
const FLAG_SURVEYED = 8;

type Layers = { water: boolean; markEstimated: boolean };

type Tile = {
  image: HTMLCanvasElement;
  paintedFor: string;
  ground: Int16Array;
  surface: Int16Array;
  flags: Int16Array;
} | null;

type Rgb = [number, number, number];

const WATER: Rgb = [28, 72, 120];
const WATER_DEEP: Rgb = [8, 28, 58];
const FOREST: Rgb = [36, 62, 34];
const PRAIRIE: Rgb = [148, 140, 88];
const ROCK = BLOCKS[Block.Stone].color;
const SNOW = BLOCKS[Block.Snow].color;

function paint(
  ground: Int16Array,
  surface: Int16Array,
  flags: Int16Array,
  level: number,
  layers: Layers,
  originX: number,
  originZ: number,
  roads: Road[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(SIZE, SIZE);
  const pixels = image.data;
  // One sample at level 0 is one metre. Coarser levels still shade per metre of rise, not per sample.
  const spacing = 1 << level;
  const metresOf = (dm: number) => (dm === NODATA ? NODATA : Math.round(dm / 10));
  const heights = new Int16Array(SIZE * SIZE);
  for (let i = 0; i < ground.length; i += 1) heights[i] = metresOf(ground[i]);
  const paved = roads.length > 0 ? rasterRoads(roads, originX, originZ, SIZE, spacing) : null;
  for (let z = 0; z < SIZE; z += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = z * SIZE + x;
      const y = heights[i];
      if (y === NODATA) continue;
      const north = z > 0 ? heights[i - SIZE] : y;
      const south = z < SIZE - 1 ? heights[i + SIZE] : y;
      const west = x > 0 ? heights[i - 1] : y;
      const east = x < SIZE - 1 ? heights[i + 1] : y;
      const rise = (a: number, b: number) => (a === NODATA || b === NODATA ? 0 : (b - a) / (2 * spacing));
      const exaggerate = 1.6 + level * 0.4;
      const gx = rise(west, east) * exaggerate;
      const gz = rise(north, south) * exaggerate;
      const slope = Math.hypot(gx, gz) / exaggerate;
      const length = Math.hypot(gx, 1, gz);
      let light = Math.max(0.35, Math.min(1.35, 0.42 + 0.95 * Math.max(0, (gx * 0.55 + 0.72 - gz * 0.48) / length)));
      const p = i * 4;
      const meters = ground[i] / 10;
      const wet = layers.water && surface[i] !== NODATA;
      const mark = paved ? paved[i] : 0;
      let color: Rgb;
      if (mark) {
        const stand = (nx: number, nz: number) => {
          const j = nz * SIZE + nx;
          if (layers.water && surface[j] !== NODATA) return metresOf(surface[j]);
          return heights[j] === NODATA ? y : heights[j];
        };
        const here = stand(x, z);
        const sNorth = z > 0 ? stand(x, z - 1) : here;
        const sSouth = z < SIZE - 1 ? stand(x, z + 1) : here;
        const sWest = x > 0 ? stand(x - 1, z) : here;
        const sEast = x < SIZE - 1 ? stand(x + 1, z) : here;
        const rgx = ((sEast - sWest) / (2 * spacing)) * exaggerate;
        const rgz = ((sSouth - sNorth) / (2 * spacing)) * exaggerate;
        const rlength = Math.hypot(rgx, 1, rgz);
        light = Math.max(0.72, Math.min(1.25, 0.55 + 0.7 * Math.max(0, (rgx * 0.55 + 0.72 - rgz * 0.48) / rlength)));
        color = ROAD_RGB[mark === 5 ? 4 : mark - 1] ?? ROAD_RGB[3];
      } else if (wet) {
        const depth = Math.max(1, metresOf(surface[i]) - y);
        const t = Math.min(1, depth / 30);
        color = [0, 1, 2].map((c) => WATER[c] + (WATER_DEEP[c] - WATER[c]) * t) as Rgb;
        if (layers.markEstimated && !(flags[i] & FLAG_SURVEYED) && (flags[i] & 7) !== 3) {
          color = [color[0] * 0.75 + 150 * 0.25, color[1] * 0.75 + 90 * 0.25, color[2] * 0.75 + 170 * 0.25];
        }
      } else if (meters >= 1600) {
        color = SNOW;
      } else if (meters >= 1450) {
        color = ROCK;
      } else {
        const flat = Math.max(0, Math.min(1, (0.09 - slope) / 0.06));
        const low = Math.max(0, Math.min(1, (880 - meters) / 180));
        const field = flat * low;
        color = [0, 1, 2].map((c) => FOREST[c] + (PRAIRIE[c] - FOREST[c]) * field) as Rgb;
      }
      pixels[p] = Math.max(0, Math.min(255, color[0] * light));
      pixels[p + 1] = Math.max(0, Math.min(255, color[1] * light));
      pixels[p + 2] = Math.max(0, Math.min(255, color[2] * light));
      pixels[p + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function WorldMap() {
  const holder = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Layers>({ water: true, markEstimated: true });
  const [status, setStatus] = useState("Loading the map.");
  const [buildSize, setBuildSize] = useState<(typeof SIZE_CHOICES)[number]>(512);
  const [building, setBuilding] = useState(false);
  const tilesRef = useRef(new Map<string, Tile>());
  const viewRef = useRef({ x: 0, z: 0, scale: 0 });

  useEffect(() => {
    const holderNode = holder.current;
    if (!holderNode) return;
    let stopped = false;
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" });
    holderNode.replaceChildren(canvas);
    const context = canvas.getContext("2d")!;
    const tiles = tilesRef.current;
    const roads: Road[] = [];
    let roadStamp = "0";
    void fetch("/api/world/roads")
      .then(async (response) => {
        if (!response.ok || stopped) return;
        roads.push(...decodeRoads(await response.arrayBuffer()));
        roadStamp = "1";
        for (const tile of tiles.values()) if (tile) tile.paintedFor = "";
        if (!stopped) redraw();
      })
      .catch(() => undefined);
    const inflight = new Set<string>();
    const view = viewRef.current;
    const paintKey = `cover/${layers.water}/${layers.markEstimated}`;
    let width = 0;
    let height = 0;
    let frame = 0;

    const fit = () => {
      view.scale = Math.min(width, height) / (WORLD.radiusMeters * 2.1);
    };
    const freshImage = (tile: NonNullable<Tile>, level: number, tx: number, tz: number) => {
      const span = SIZE << level;
      const paintedFor = `${paintKey}/${roadStamp}/${tx}/${tz}`;
      if (tile.paintedFor !== paintedFor) {
        tile.image = paint(tile.ground, tile.surface, tile.flags, level, layers, tx * span, tz * span, roads);
        tile.paintedFor = paintedFor;
      }
      return tile.image;
    };

    // Stay on the 1 m grid until a pixel covers more than one metre.
    const levelFor = (scale: number) => {
      if (scale >= 1) return 0;
      return Math.max(0, Math.min(MAX_LEVEL, Math.floor(Math.log2(1 / scale))));
    };
    const onScreen = new Set<string>();
    const toScreen = (x: number, z: number) => ({ sx: (x - view.x) * view.scale + width / 2, sy: (z - view.z) * view.scale + height / 2 });
    const toWorld = (sx: number, sy: number) => ({ x: view.x + (sx - width / 2) / view.scale, z: view.z + (sy - height / 2) / view.scale });

    const remember = (key: string, tile: Tile) => {
      tiles.delete(key);
      tiles.set(key, tile);
      if (tile === null) return;
      let painted = 0;
      for (const entry of tiles.values()) if (entry) painted += 1;
      for (const [old, entry] of tiles) {
        if (painted <= CACHE_LIMIT) break;
        if (!entry || onScreen.has(old)) continue;
        tiles.delete(old);
        painted -= 1;
      }
    };

    const queue: { level: number; tx: number; tz: number; d: number }[] = [];
    const pump = () => {
      while (inflight.size < 6 && queue.length > 0 && !stopped) {
        const { level, tx, tz } = queue.shift()!;
        const key = `${level}/${tx}/${tz}`;
        if (tiles.has(key) || inflight.has(key)) continue;
        inflight.add(key);
        void fetch(`/api/world/tile/${level}/${tx}/${tz}`)
          .then(async (response) => {
            if (stopped) return;
            if (response.status === 204 || !response.ok) {
              remember(key, null);
              return;
            }
            const buffer = await new Response(response.body!.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
            if (stopped) return;
            const ground = new Int16Array(buffer, 0, SIZE * SIZE);
            const surface = new Int16Array(buffer, SIZE * SIZE * 2, SIZE * SIZE);
            const flags = new Int16Array(buffer, SIZE * SIZE * 4, SIZE * SIZE);
            const span = SIZE << level;
            const paintedFor = `${paintKey}/${roadStamp}/${tx}/${tz}`;
            remember(key, {
              image: paint(ground, surface, flags, level, layers, tx * span, tz * span, roads),
              paintedFor,
              ground,
              surface,
              flags,
            });
          })
          .catch(() => undefined)
          .finally(() => {
            inflight.delete(key);
            if (!stopped) {
              redraw();
              pump();
            }
          });
      }
      setStatus(inflight.size + queue.length > 0 ? `Loading ${inflight.size + queue.length} tiles.` : "");
    };

    const tileAt = (level: number, x: number, z: number) => {
      const span = SIZE << level;
      return { tx: Math.floor(x / span), tz: Math.floor(z / span) };
    };

    const draw = () => {
      frame = 0;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#14202a";
      context.fillRect(0, 0, width, height);
      const level = levelFor(view.scale);
      const span = SIZE << level;
      const a = toWorld(0, 0);
      const b = toWorld(width, height);
      const wanted: typeof queue = [];
      context.imageSmoothingEnabled = false;
      onScreen.clear();
      for (let tz = Math.floor(a.z / span); tz <= Math.floor(b.z / span); tz += 1) {
        for (let tx = Math.floor(a.x / span); tx <= Math.floor(b.x / span); tx += 1) {
          const key = `${level}/${tx}/${tz}`;
          onScreen.add(key);
          const tile = tiles.get(key);
          const { sx, sy } = toScreen(tx * span, tz * span);
          const sizeOnScreen = span * view.scale;
          if (tile) {
            context.drawImage(freshImage(tile, level, tx, tz), sx, sy, sizeOnScreen + 0.5, sizeOnScreen + 0.5);
            continue;
          }
          if (tile === null) continue;
          for (let up = level + 1; up <= MAX_LEVEL; up += 1) {
            const parentSpan = SIZE << up;
            const ptx = Math.floor((tx * span) / parentSpan);
            const ptz = Math.floor((tz * span) / parentSpan);
            const parent = tiles.get(`${up}/${ptx}/${ptz}`);
            if (!parent) continue;
            const part = SIZE >> (up - level);
            const ox = ((tx * span - ptx * parentSpan) / parentSpan) * SIZE;
            const oz = ((tz * span - ptz * parentSpan) / parentSpan) * SIZE;
            context.drawImage(freshImage(parent, up, ptx, ptz), ox, oz, part, part, sx, sy, sizeOnScreen + 0.5, sizeOnScreen + 0.5);
            break;
          }
          const center = toWorld(width / 2, height / 2);
          wanted.push({ level, tx, tz, d: Math.hypot((tx + 0.5) * span - center.x, (tz + 0.5) * span - center.z) });
        }
      }
      const origin = toScreen(0, 0);
      const radius = WORLD.radiusMeters * view.scale;
      context.save();
      context.beginPath();
      context.rect(0, 0, width, height);
      context.arc(origin.sx, origin.sy, radius, 0, Math.PI * 2, true);
      context.fillStyle = "#14202a";
      context.fill("evenodd");
      context.beginPath();
      context.arc(origin.sx, origin.sy, radius, 0, Math.PI * 2);
      context.strokeStyle = "rgba(255, 250, 243, 0.55)";
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      context.arc(origin.sx, origin.sy, 5, 0, Math.PI * 2);
      context.strokeStyle = "#fffaf3";
      context.lineWidth = 2;
      context.stroke();
      context.restore();
      wanted.sort((p, q) => p.d - q.d);
      queue.splice(0, queue.length, ...wanted);
      pump();
    };
    const redraw = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };

    const resize = () => {
      width = holderNode.clientWidth;
      height = holderNode.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      if (view.scale === 0 && width > 0) fit();
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(holderNode);

    const probe = (x: number, z: number) => {
      for (let level = 0; level <= MAX_LEVEL; level += 1) {
        const { tx, tz } = tileAt(level, x, z);
        const tile = tiles.get(`${level}/${tx}/${tz}`);
        if (!tile) continue;
        const step = 1 << level;
        const i = Math.floor((z - tz * (SIZE << level)) / step) * SIZE + Math.floor((x - tx * (SIZE << level)) / step);
        return { ground: tile.ground[i], surface: tile.surface[i], flags: tile.flags[i], level };
      }
      return null;
    };
    const describe = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const point = toWorld(event.clientX - rect.left, event.clientY - rect.top);
      const bx = Math.floor(point.x);
      const bz = Math.floor(point.z);
      const utm = blockToUtm(bx + 0.5, bz + 0.5);
      const geo = fromUtm(utm.e, utm.n);
      const sample = probe(point.x, point.z);
      const parts = [`x ${bx}, z ${bz}`, `${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}`];
      if (sample && sample.ground !== NODATA) {
        const wet = sample.surface !== NODATA;
        const top = wet ? sample.surface / 10 : sample.ground / 10;
        parts.push(`${top.toFixed(1)} m, y ${minecraftY(top)}`);
        if (wet) {
          const depth = (sample.surface - sample.ground) / 10;
          const source = (sample.flags & 7) === 3 ? "stream" : sample.flags & FLAG_SURVEYED ? "surveyed" : "estimated";
          parts.push(`water ${depth.toFixed(1)} m deep (${source})`);
        }
        if (sample.level > 0) parts.push(`${1 << sample.level} m detail`);
      }
      if (readout.current) readout.current.textContent = parts.join("  ·  ");
    };

    let dragging = false;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (event: PointerEvent) => {
      describe(event);
      if (!dragging) return;
      view.x -= event.movementX / view.scale;
      view.z -= event.movementY / view.scale;
      redraw();
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const before = toWorld(sx, sy);
      view.scale = Math.min(16, Math.max(Math.min(width, height) / (WORLD.radiusMeters * 3), view.scale * factor));
      const after = toWorld(sx, sy);
      view.x += before.x - after.x;
      view.z += before.z - after.z;
      redraw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0018));
    };
    const onDouble = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.shiftKey ? 0.5 : 2);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDouble);

    return () => {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (holderNode.contains(canvas)) holderNode.removeChild(canvas);
    };
  }, [layers]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#14202a] text-[#1c1915]">
      <div ref={holder} className="absolute inset-0" />
      <div className="absolute top-3 left-3 max-w-sm rounded-2xl bg-[#fffaf3]/94 px-4 py-3 text-sm shadow-sm">
        <Link href="/ufos" className="mb-2 inline-block text-xs font-semibold text-[#234e45] underline underline-offset-2">UFO Studio</Link>
        <div className="flex flex-col gap-1 text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked readOnly disabled /> Terrain
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={layers.water} onChange={(event) => setLayers((now) => ({ ...now, water: event.target.checked }))} />
            Water
          </label>
          <label className="ml-5 flex items-center gap-2">
            <input
              type="checkbox"
              checked={layers.markEstimated}
              disabled={!layers.water}
              onChange={(event) => setLayers((now) => ({ ...now, markEstimated: event.target.checked }))}
            />
            Tint water whose depth is estimated
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className="rounded-full bg-[#efe6d6] px-2.5 py-1 text-xs"
              value={buildSize}
              disabled={building}
              onChange={(event) => setBuildSize(Number(event.target.value) as (typeof SIZE_CHOICES)[number])}
            >
              {SIZE_CHOICES.map((size) => (
                <option key={size} value={size}>
                  {size} × {size} m
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={building}
              className="rounded-full bg-[#234e45] px-3 py-1 text-xs text-[#f6f1e7] disabled:opacity-60"
              onClick={() => {
                const { x, z } = viewRef.current;
                setBuilding(true);
                void fetch("/api/world/build", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ x, z, size: buildSize }),
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      const body = (await response.json().catch(() => null)) as { error?: string } | null;
                      throw new Error(body?.error ?? "Build failed.");
                    }
                    const blob = await response.blob();
                    const name =
                      response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
                      `inland-northwest-${buildSize}.mcworld`;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = name;
                    link.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => undefined)
                  .finally(() => setBuilding(false));
              }}
            >
              {building ? "Building…" : "Download .mcworld"}
            </button>
        </div>
      </div>
      {status && <div className="pointer-events-none absolute top-3 right-3 rounded-full bg-[#fffaf3]/92 px-3 py-1 text-xs">{status}</div>}
      <div
        ref={readout}
        className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[#fffaf3]/92 px-3 py-1 text-xs tabular-nums empty:hidden"
      />
    </div>
  );
}
