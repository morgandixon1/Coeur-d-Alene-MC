"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

export type Spot = { x: number; y: number; z: number };

const RADIUS = 5;
const DROP_RADIUS = RADIUS + 3;

export function FlyView({ world, where, onMessage }: { world: string; where: RefObject<Spot>; onMessage: (text: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const speed = useRef(48);

  useEffect(() => {
    const holderNode = holder.current;
    if (!holderNode) return;
    let stopped = false;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new Color("#8ec6ea"));
    renderer.domElement.style.display = "block";
    holderNode.replaceChildren(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(70, 1, 0.1, 4000);
    const material = new MeshBasicMaterial({ vertexColors: true });
    const loaded = new Map<string, Mesh>();
    const seen = new Set<string>();
    const held = new Set<string>();
    const look = { yaw: 0, pitch: -0.4 };
    const velocity = { x: 0, y: 0, z: 0 };
    camera.position.set(where.current.x, where.current.y, where.current.z);
    onMessage("Drag to look, WASD to fly, Space or E up, Shift or Q down. Double-click captures the mouse, Esc frees it. Scroll changes speed.");

    const resize = () => {
      const width = holderNode.clientWidth;
      const height = holderNode.clientHeight;
      if (width < 2 || height < 2) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(holderNode);

    const queue: { cx: number; cz: number }[] = [];
    let pulling = false;
    const pull = async () => {
      if (pulling || queue.length === 0 || stopped) return;
      pulling = true;
      const batch = queue.splice(0, 6);
      try {
        const response = await fetch("/api/fly/chunks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ world, chunks: batch }),
        });
        if (!response.ok || stopped) {
          for (const chunk of batch) seen.delete(`${chunk.cx},${chunk.cz}`);
          return;
        }
        const buffer = await response.arrayBuffer();
        if (stopped) return;
        const view = new DataView(buffer);
        let offset = 2;
        const count = view.getUint16(0, true);
        for (let i = 0; i < count; i += 1) {
          const cx = view.getInt32(offset, true);
          const cz = view.getInt32(offset + 4, true);
          const length = view.getUint32(offset + 8, true);
          offset += 12;
          const vertices = length / 10;
          const positions = new Float32Array(vertices * 3);
          const colors = new Float32Array(vertices * 3);
          for (let vertex = 0; vertex < vertices; vertex += 1) {
            const at = offset + vertex * 10;
            positions[vertex * 3] = view.getInt16(at, true) + cx * 16;
            positions[vertex * 3 + 1] = view.getInt16(at + 2, true);
            positions[vertex * 3 + 2] = view.getInt16(at + 4, true) + cz * 16;
            colors[vertex * 3] = view.getUint8(at + 6) / 255;
            colors[vertex * 3 + 1] = view.getUint8(at + 7) / 255;
            colors[vertex * 3 + 2] = view.getUint8(at + 8) / 255;
          }
          offset += length;
          if (vertices === 0 || !seen.has(`${cx},${cz}`)) continue;
          const geometry = new BufferGeometry();
          geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
          geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
          const mesh = new Mesh(geometry, material);
          scene.add(mesh);
          loaded.set(`${cx},${cz}`, mesh);
        }
      } finally {
        pulling = false;
        if (queue.length > 0) void pull();
      }
    };

    let lastCenter = "";
    const ensure = (cx: number, cz: number) => {
      const center = `${cx},${cz}`;
      if (center === lastCenter) return;
      lastCenter = center;
      for (const key of seen) {
        const [kx, kz] = key.split(",").map(Number);
        if (Math.abs(kx - cx) <= DROP_RADIUS && Math.abs(kz - cz) <= DROP_RADIUS) continue;
        seen.delete(key);
        const mesh = loaded.get(key);
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          loaded.delete(key);
        }
      }
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (!seen.has(`${queue[i].cx},${queue[i].cz}`)) queue.splice(i, 1);
      }
      const wanted: { cx: number; cz: number }[] = [];
      for (let dz = -RADIUS; dz <= RADIUS; dz += 1) {
        for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
          const key = `${cx + dx},${cz + dz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          wanted.push({ cx: cx + dx, cz: cz + dz });
        }
      }
      wanted.sort((a, b) => Math.hypot(a.cx - cx, a.cz - cz) - Math.hypot(b.cx - cx, b.cz - cz));
      queue.push(...wanted);
      void pull();
    };

    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    let dragging = false;
    let dragMoved = 0;
    const locked = () => document.pointerLockElement === canvas;
    const turn = (dx: number, dy: number, rate: number) => {
      look.yaw -= dx * rate;
      look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch - dy * rate));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (locked() || event.button !== 0) return;
      dragging = true;
      dragMoved = 0;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (locked()) {
        turn(event.movementX, event.movementY, 0.0022);
      } else if (dragging) {
        dragMoved += Math.abs(event.movementX) + Math.abs(event.movementY);
        turn(event.movementX, event.movementY, 0.004);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onDoubleClick = () => {
      if (locked() || dragMoved >= 4) return;
      const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      request?.catch(() => onMessage("This browser would not capture the mouse. Drag to look instead."));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      speed.current = Math.min(400, Math.max(4, speed.current * (event.deltaY > 0 ? 0.88 : 1.14)));
      onMessage(`Speed ${Math.round(speed.current)} blocks per second.`);
    };
    const typing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    };
    const onKey = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^(Space|Arrow|Key[WASDQE])/.test(event.code)) {
        event.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      }
      held.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      held.delete(event.code);
      if (event.key === "Meta" || event.key === "Control" || event.key === "Alt") held.clear();
    };
    const release = () => {
      held.clear();
      dragging = false;
    };
    const onVisibility = () => {
      if (document.hidden) release();
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerlockchange", release);

    const clock = new Clock();
    let frame = 0;
    const loop = () => {
      frame = window.requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      camera.rotation.order = "YXZ";
      camera.rotation.y = look.yaw;
      camera.rotation.x = look.pitch;
      const forwardX = -Math.sin(look.yaw) * Math.cos(look.pitch);
      const forwardY = Math.sin(look.pitch);
      const forwardZ = -Math.cos(look.yaw) * Math.cos(look.pitch);
      const rightX = Math.cos(look.yaw);
      const rightZ = -Math.sin(look.yaw);
      const forward = (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0) - (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0);
      const strafe = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
      const lift = (held.has("Space") || held.has("KeyE") ? 1 : 0) - (held.has("ShiftLeft") || held.has("ShiftRight") || held.has("KeyQ") ? 1 : 0);
      const yawTurn = (held.has("ArrowLeft") ? 1 : 0) - (held.has("ArrowRight") ? 1 : 0);
      look.yaw += yawTurn * 1.8 * dt;
      const mx = forwardX * forward + rightX * strafe;
      const my = forwardY * forward + lift;
      const mz = forwardZ * forward + rightZ * strafe;
      const length = Math.hypot(mx, my, mz);
      const target = length > 0 ? speed.current / length : 0;
      const ease = 1 - Math.exp(-dt * 12);
      velocity.x += (mx * target - velocity.x) * ease;
      velocity.y += (my * target - velocity.y) * ease;
      velocity.z += (mz * target - velocity.z) * ease;
      camera.position.x += velocity.x * dt;
      camera.position.y += velocity.y * dt;
      camera.position.z += velocity.z * dt;
      where.current = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      ensure(Math.floor(camera.position.x / 16), Math.floor(camera.position.z / 16));
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (locked()) document.exitPointerLock();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", release);
      renderer.dispose();
      material.dispose();
      for (const mesh of loaded.values()) mesh.geometry.dispose();
      if (holderNode.contains(renderer.domElement)) holderNode.removeChild(renderer.domElement);
    };
  }, [world, where, onMessage]);

  return <div ref={holder} className="absolute inset-0" />;
}
