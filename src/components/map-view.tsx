"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Spot } from "@/components/fly-view";

const NO_TOP = -32768;
const TILE_BYTES = 256 * 5;
const MIN_SCALE = 1;
const MAX_SCALE = 24;

type Tile = { image: HTMLCanvasElement; heights: Int16Array } | null;

function paintTile(view: DataView, offset: number): Tile {
  const heights = new Int16Array(256);
  let filled = 0;
  for (let column = 0; column < 256; column += 1) {
    heights[column] = view.getInt16(offset + column * 5 + 3, true);
    if (heights[column] !== NO_TOP) filled += 1;
  }
  if (filled === 0) return null;
  const image = document.createElement("canvas");
  image.width = 16;
  image.height = 16;
  const context = image.getContext("2d");
  if (!context) return null;
  const pixels = context.createImageData(16, 16);
  for (let z = 0; z < 16; z += 1) {
    for (let x = 0; x < 16; x += 1) {
      const column = z * 16 + x;
      const height = heights[column];
      if (height === NO_TOP) continue;
      const north = z > 0 ? heights[column - 16] : x > 0 ? heights[column - 1] : height;
      const slope = north === NO_TOP ? 0 : height - north;
      const light = 1 + Math.max(-0.3, Math.min(0.3, slope * 0.09));
      const at = offset + column * 5;
      const pixel = column * 4;
      pixels.data[pixel] = Math.min(255, view.getUint8(at) * light);
      pixels.data[pixel + 1] = Math.min(255, view.getUint8(at + 1) * light);
      pixels.data[pixel + 2] = Math.min(255, view.getUint8(at + 2) * light);
      pixels.data[pixel + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return { image, heights };
}

export function MapView({
  world,
  spawn,
  where,
  onMessage,
  onFly,
}: {
  world: string;
  spawn: Spot;
  where: RefObject<Spot>;
  onMessage: (text: string) => void;
  onFly: (spot: Spot) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holderNode = holder.current;
    if (!holderNode) return;
    let stopped = false;
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    holderNode.replaceChildren(canvas);
    const context = canvas.getContext("2d");
    if (!context) return;
    const tiles = new Map<string, Tile>();
    const asked = new Set<string>();
    const center = { x: where.current.x, z: where.current.z };
    let scale = 3;
    let width = 0;
    let height = 0;
    let frame = 0;
    onMessage("Drag to pan, scroll to zoom, double-click to fly there in 3D.");

    const toWorld = (sx: number, sy: number) => ({ x: center.x + (sx - width / 2) / scale, z: center.z + (sy - height / 2) / scale });

    const draw = () => {
      frame = 0;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#1b2a33";
      context.fillRect(0, 0, width, height);
      const left = toWorld(0, 0);
      const right = toWorld(width, height);
      const missing: { cx: number; cz: number; d: number }[] = [];
      const size = 16 * scale;
      for (let cz = Math.floor(left.z / 16); cz <= Math.floor(right.z / 16); cz += 1) {
        for (let cx = Math.floor(left.x / 16); cx <= Math.floor(right.x / 16); cx += 1) {
          const key = `${cx},${cz}`;
          const tile = tiles.get(key);
          const sx = Math.floor((cx * 16 - center.x) * scale + width / 2);
          const sy = Math.floor((cz * 16 - center.z) * scale + height / 2);
          if (tile) context.drawImage(tile.image, sx, sy, Math.ceil(size), Math.ceil(size));
          else if (tile === undefined && !asked.has(key)) {
            missing.push({ cx, cz, d: Math.hypot(cx * 16 + 8 - center.x, cz * 16 + 8 - center.z) });
          }
        }
      }
      const spawnX = (spawn.x - center.x) * scale + width / 2;
      const spawnY = (spawn.z - center.z) * scale + height / 2;
      context.strokeStyle = "#fffaf3";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(spawnX, spawnY, 6, 0, Math.PI * 2);
      context.stroke();
      missing.sort((a, b) => a.d - b.d);
      queue.splice(0, queue.length, ...missing.map(({ cx, cz }) => ({ cx, cz })));
      void pull();
    };
    const redraw = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };

    const queue: { cx: number; cz: number }[] = [];
    let pulling = 0;
    const pull = async () => {
      if (pulling >= 2 || queue.length === 0 || stopped) return;
      pulling += 1;
      const batch = queue.splice(0, 64);
      for (const chunk of batch) asked.add(`${chunk.cx},${chunk.cz}`);
      try {
        const response = await fetch("/api/fly/tops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ world, chunks: batch }),
        });
        if (stopped) return;
        if (!response.ok) {
          for (const chunk of batch) tiles.set(`${chunk.cx},${chunk.cz}`, null);
          onMessage("Some chunks could not be read and are left blank.");
          return;
        }
        const view = new DataView(await response.arrayBuffer());
        if (stopped) return;
        const count = view.getUint16(0, true);
        let offset = 2;
        for (let i = 0; i < count; i += 1) {
          const cx = view.getInt32(offset, true);
          const cz = view.getInt32(offset + 4, true);
          tiles.set(`${cx},${cz}`, paintTile(view, offset + 8));
          offset += 8 + TILE_BYTES;
        }
      } finally {
        for (const chunk of batch) asked.delete(`${chunk.cx},${chunk.cz}`);
        pulling -= 1;
        if (!stopped) redraw();
      }
    };

    const resize = () => {
      width = holderNode.clientWidth;
      height = holderNode.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(holderNode);

    const heightAt = (x: number, z: number) => {
      const tile = tiles.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
      if (!tile) return null;
      const value = tile.heights[(Math.floor(z) & 15) * 16 + (Math.floor(x) & 15)];
      return value === NO_TOP ? null : value;
    };
    const describe = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const point = toWorld(event.clientX - rect.left, event.clientY - rect.top);
      const top = heightAt(point.x, point.z);
      if (readout.current) {
        readout.current.textContent = `x ${Math.floor(point.x)}  z ${Math.floor(point.z)}${top === null ? "" : `  top y ${top}`}`;
      }
      return { ...point, top };
    };

    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      describe(event);
      if (!dragging) return;
      center.x -= event.movementX / scale;
      center.z -= event.movementY / scale;
      where.current = { ...where.current, x: center.x, z: center.z };
      redraw();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = toWorld(sx, sy);
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.exp(-event.deltaY * 0.0015)));
      const after = toWorld(sx, sy);
      center.x += before.x - after.x;
      center.z += before.z - after.z;
      where.current = { ...where.current, x: center.x, z: center.z };
      redraw();
    };
    const onDoubleClick = (event: MouseEvent) => {
      const point = describe(event);
      onFly({ x: point.x, y: (point.top ?? where.current.y - 40) + 40, z: point.z });
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);

    return () => {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (holderNode.contains(canvas)) holderNode.removeChild(canvas);
    };
  }, [world, spawn, where, onMessage, onFly]);

  return (
    <>
      <div ref={holder} className="absolute inset-0" />
      <div
        ref={readout}
        className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[#fffaf3]/92 px-3 py-1 text-xs tabular-nums text-[#1c1915]"
      />
    </>
  );
}
