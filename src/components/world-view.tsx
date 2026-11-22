"use client";

import { useEffect, useRef, useState } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  MOUSE,
  Raycaster,
  TOUCH,
  Vector2,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import { BLOCKS, Block, blockLabel, blockSwatch, type BlockId } from "@/lib/blocks";
import { timeLabel, type ThemeId } from "@/lib/settings";
import { BASE_Y, blockAt, blockCensus, hash01, type GeneratedWorld } from "@/lib/terrain";

const SKY: Record<ThemeId, string> = {
  "pine-camp": "#c5d4e4",
  cove: "#b7d6ea",
  mesa: "#f0c7a4",
  snowfield: "#d9e7f2",
  festival: "#f6d7a8",
};

type Vec3 = [number, number, number];

function addQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  corners: [Vec3, Vec3, Vec3, Vec3],
  normal: Vec3,
  color: Vec3,
) {
  const [a, b, c, d] = corners;
  for (const point of [a, b, c, a, c, d]) {
    positions.push(point[0], point[1], point[2]);
    normals.push(normal[0], normal[1], normal[2]);
    colors.push(color[0], color[1], color[2]);
  }
}

function tint(block: BlockId, x: number, y: number, z: number): Vec3 {
  const [r, g, b] = BLOCKS[block].color;
  const mix = 0.9 + hash01(x + y, z, 3) * 0.14;
  const color = new Color();
  color.setRGB((r * mix) / 255, (g * mix) / 255, (b * mix) / 255, SRGBColorSpace);
  return [color.r, color.g, color.b];
}

function geometryFrom(positions: number[], normals: number[], colors: number[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function disposeMaterial(material: Material | Material[]) {
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
}

function sunStrength(tick: number): number {
  return Math.max(0, Math.cos(((tick - 6000) / 24000) * Math.PI * 2));
}

function buildTerrain(world: GeneratedWorld) {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const waterPositions: number[] = [];
  const waterNormals: number[] = [];
  const waterColors: number[] = [];
  const ox = -world.size / 2;
  const oz = -world.size / 2;

  const visualAt = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= world.size || z >= world.size) return BASE_Y;
    const cell = z * world.size + x;
    return world.waterTop[cell] >= 0 ? Math.max(world.heights[cell], world.waterTop[cell]) : world.heights[cell];
  };

  for (let z = 0; z < world.size; z += 1) {
    for (let x = 0; x < world.size; x += 1) {
      const cell = z * world.size + x;
      const solid = world.heights[cell];
      const water = world.waterTop[cell];
      const visual = water >= 0 ? Math.max(solid, water) : solid;
      const x0 = x + ox;
      const z0 = z + oz;

      if (water >= solid) {
        const y = water + 1;
        addQuad(
          waterPositions,
          waterNormals,
          waterColors,
          [
            [x0, y, z0],
            [x0, y, z0 + 1],
            [x0 + 1, y, z0 + 1],
            [x0 + 1, y, z0],
          ],
          [0, 1, 0],
          tint(Block.Water, x, y, z),
        );
      } else {
        const y = solid + 1;
        addQuad(
          positions,
          normals,
          colors,
          [
            [x0, y, z0],
            [x0, y, z0 + 1],
            [x0 + 1, y, z0 + 1],
            [x0 + 1, y, z0],
          ],
          [0, 1, 0],
          tint(blockAt(world, x, solid, z), x, solid, z),
        );
      }

      const faces: {
        dx: number;
        dz: number;
        normal: Vec3;
        corners: (low: number, high: number) => [Vec3, Vec3, Vec3, Vec3];
      }[] = [
        {
          dx: 1,
          dz: 0,
          normal: [1, 0, 0],
          corners: (low, high) => [
            [x0 + 1, low, z0],
            [x0 + 1, low, z0 + 1],
            [x0 + 1, high, z0 + 1],
            [x0 + 1, high, z0],
          ],
        },
        {
          dx: -1,
          dz: 0,
          normal: [-1, 0, 0],
          corners: (low, high) => [
            [x0, low, z0 + 1],
            [x0, low, z0],
            [x0, high, z0],
            [x0, high, z0 + 1],
          ],
        },
        {
          dx: 0,
          dz: 1,
          normal: [0, 0, 1],
          corners: (low, high) => [
            [x0 + 1, low, z0 + 1],
            [x0, low, z0 + 1],
            [x0, high, z0 + 1],
            [x0 + 1, high, z0 + 1],
          ],
        },
        {
          dx: 0,
          dz: -1,
          normal: [0, 0, -1],
          corners: (low, high) => [
            [x0, low, z0],
            [x0 + 1, low, z0],
            [x0 + 1, high, z0],
            [x0, high, z0],
          ],
        },
      ];

      for (const face of faces) {
        const neighbor = visualAt(x + face.dx, z + face.dz);
        if (visual <= neighbor) continue;
        const low = neighbor + 1;
        const high = visual + 1;
        const sampleY = Math.min(visual, Math.max(low, Math.floor((neighbor + visual) / 2)));
        const block = blockAt(world, x, sampleY, z);
        const bucket = block === Block.Water ? [waterPositions, waterNormals, waterColors] : [positions, normals, colors];
        addQuad(bucket[0], bucket[1], bucket[2], face.corners(low, high), face.normal, tint(block, x, sampleY, z));
      }
    }
  }

  const pad = 32;
  const skirt = BASE_Y + 1;
  const grass = tint(Block.Grass, 4, BASE_Y, 4);
  const west = ox - pad;
  const east = ox + world.size + pad;
  const north = oz - pad;
  const south = oz + world.size + pad;
  const strips: [number, number, number, number][] = [
    [west, ox, north, south],
    [ox + world.size, east, north, south],
    [ox, ox + world.size, north, oz],
    [ox, ox + world.size, oz + world.size, south],
  ];
  for (const [ax, bx, az, bz] of strips) {
    addQuad(
      positions,
      normals,
      colors,
      [
        [ax, skirt, az],
        [ax, skirt, bz],
        [bx, skirt, bz],
        [bx, skirt, az],
      ],
      [0, 1, 0],
      grass,
    );
  }

  return {
    land: geometryFrom(positions, normals, colors),
    water: geometryFrom(waterPositions, waterNormals, waterColors),
  };
}

function frameCamera(camera: PerspectiveCamera, controls: OrbitControls, world: GeneratedWorld) {
  const ox = -world.size / 2;
  const oz = -world.size / 2;
  const midX = ox + world.size / 2;
  const midZ = oz + world.size / 2;
  controls.target.set(midX, BASE_Y + 2, midZ);
  camera.position.set(midX + world.size * 0.05, world.size * 0.9, midZ + world.size * 0.78);
  camera.near = 0.1;
  camera.far = 800;
  camera.updateProjectionMatrix();
  controls.update();
}

export function WorldView({ world }: { world: GeneratedWorld }) {
  const holder = useRef<HTMLDivElement>(null);
  const worldRef = useRef(world);
  worldRef.current = world;
  const [webglError, setWebglError] = useState(false);
  const swatch = useRef<HTMLSpanElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const place = useRef<HTMLSpanElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const sunRef = useRef<DirectionalLight | null>(null);
  const skyRef = useRef<HemisphereLight | null>(null);
  const terrainKey = `${world.settings.theme}:${world.settings.seed}:${world.settings.size}`;
  const legend = blockCensus(world);

  useEffect(() => {
    const holderNode = holder.current;
    if (!holderNode) return;
    const current = worldRef.current;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      setWebglError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.domElement.className = "h-full w-full touch-none";
    renderer.domElement.setAttribute("aria-label", "Colored overlook of the drafted world");
    holderNode.replaceChildren(renderer.domElement);

    const scene = new Scene();
    const sky = SKY[current.settings.theme];
    scene.background = new Color(sky);
    scene.fog = new Fog(sky, current.size * 0.55, current.size + 90);
    const hemi = new HemisphereLight(0xf4f7fb, 0x6d8a58, 0.72);
    const sun = new DirectionalLight(0xfff1d6, 1.15);
    sun.position.set(40, 70, 24);
    scene.add(hemi, sun);
    skyRef.current = hemi;
    sunRef.current = sun;
    const strength = sunStrength(current.settings.timeOfDay);
    sun.intensity = 0.25 + strength * 1.15;
    hemi.intensity = 0.28 + strength * 0.5;

    const camera = new PerspectiveCamera(48, 1, 0.1, 800);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = 1.02;
    controls.minPolarAngle = 0.05;
    controls.minDistance = Math.max(10, current.size * 0.18);
    controls.maxDistance = current.size * 2.4;
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    frameCamera(camera, controls, current);
    resetRef.current = () => frameCamera(camera, controls, worldRef.current);

    const built = buildTerrain(current);
    const land = new Mesh(built.land, new MeshLambertMaterial({ vertexColors: true }));
    land.userData.kind = "land";
    const water = new Mesh(
      built.water,
      new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false }),
    );
    water.userData.kind = "water";
    water.renderOrder = 2;
    scene.add(land, water);

    const ox = -current.size / 2;
    const oz = -current.size / 2;
    const dummy = new Object3D();
    const unit = new BoxGeometry(1, 1, 1);
    const featureMeshes: InstancedMesh[] = [];
    const groups = new Map<BlockId, typeof current.features>();
    for (const feature of current.features) {
      const ground = current.heights[feature.z * current.size + feature.x];
      if (feature.y <= ground && BLOCKS[feature.block].scale === undefined) continue;
      const list = groups.get(feature.block) ?? [];
      list.push(feature);
      groups.set(feature.block, list);
    }
    const pickables: Object3D[] = [land, water];
    for (const [block, list] of groups) {
      const def = BLOCKS[block];
      const [sx, sy, sz] = def.scale ?? [1, 1, 1];
      const color = new Color().setRGB(def.color[0] / 255, def.color[1] / 255, def.color[2] / 255, SRGBColorSpace);
      const material = def.bright ? new MeshBasicMaterial({ color }) : new MeshLambertMaterial({ color });
      const mesh = new InstancedMesh(unit, material, list.length);
      mesh.userData.features = list;
      list.forEach((feature, index) => {
        dummy.position.set(feature.x + ox + 0.5, feature.y + sy / 2, feature.z + oz + 0.5);
        dummy.scale.set(sx, sy, sz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      featureMeshes.push(mesh);
      pickables.push(mesh);
    }

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const showBlock = (block: BlockId, x: number, y: number, z: number, note?: string) => {
      if (swatch.current) swatch.current.style.background = blockSwatch(block);
      if (name.current) name.current.textContent = note ? `${blockLabel(block)} · ${note}` : blockLabel(block);
      if (place.current) place.current.textContent = `${x}  ${y}  ${z}`;
    };
    const clearBlock = () => {
      if (swatch.current) swatch.current.style.background = "transparent";
      if (name.current) name.current.textContent = "Hover a block";
      if (place.current) place.current.textContent = "";
    };
    const onPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      const hit = hits[0];
      if (!hit) {
        clearBlock();
        return;
      }
      const live = worldRef.current;
      const originX = -live.size / 2;
      const originZ = -live.size / 2;
      const features = hit.object.userData.features as GeneratedWorld["features"] | undefined;
      if (features && hit.instanceId !== undefined) {
        const feature = features[hit.instanceId];
        if (feature) {
          showBlock(feature.block, feature.x, feature.y, feature.z);
          return;
        }
      }
      const nudged = hit.point.clone();
      if (hit.face) nudged.addScaledVector(hit.face.normal, -0.05);
      const x = Math.floor(nudged.x - originX);
      const y = Math.floor(nudged.y);
      const z = Math.floor(nudged.z - originZ);
      if (x < 0 || z < 0 || x >= live.size || z >= live.size) {
        showBlock(Block.Grass, x, BASE_Y, z, "outside the draft");
        return;
      }
      const block = hit.object.userData.kind === "water" ? Block.Water : blockAt(live, x, y, z);
      showBlock(block === Block.Air ? Block.Grass : block, x, y, z);
    };
    renderer.domElement.addEventListener("pointermove", onPointer);
    renderer.domElement.addEventListener("pointerleave", clearBlock);

    const resize = () => {
      const width = holderNode.clientWidth;
      const height = holderNode.clientHeight;
      if (width < 2 || height < 2) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(holderNode);

    let frame = 0;
    const loop = () => {
      frame = window.requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointer);
      renderer.domElement.removeEventListener("pointerleave", clearBlock);
      controls.dispose();
      land.geometry.dispose();
      water.geometry.dispose();
      disposeMaterial(land.material);
      disposeMaterial(water.material);
      for (const mesh of featureMeshes) disposeMaterial(mesh.material);
      unit.dispose();
      renderer.dispose();
      sunRef.current = null;
      skyRef.current = null;
      resetRef.current = () => {};
      if (holderNode.contains(renderer.domElement)) holderNode.removeChild(renderer.domElement);
    };
  }, [terrainKey]);

  useEffect(() => {
    const strength = sunStrength(world.settings.timeOfDay);
    const angle = ((world.settings.timeOfDay - 6000) / 24000) * Math.PI * 2;
    if (sunRef.current) {
      sunRef.current.intensity = 0.25 + strength * 1.15;
      sunRef.current.position.set(Math.sin(angle) * 50, 18 + strength * 70, Math.cos(angle) * 30);
    }
    if (skyRef.current) skyRef.current.intensity = 0.28 + strength * 0.5;
  }, [world.settings.timeOfDay, terrainKey]);

  return (
    <div className="relative h-full min-h-[320px] w-full bg-[#d5e2ea]">
      <div ref={holder} className="absolute inset-0" />
      {webglError ? (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <p className="max-w-sm text-sm text-[#1c1915]">
            This browser could not start the overlook. The block list and the .mcworld download still work.
          </p>
        </div>
      ) : null}
      <ul className="absolute top-16 left-3 z-10 flex max-h-[42%] flex-col gap-1 overflow-y-auto rounded-2xl bg-[#fffaf3]/92 p-2 text-xs text-[#1c1915]">
        {legend.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm border border-[#1c1915]/15"
              style={{ background: blockSwatch(entry.id) }}
            />
            <span>{blockLabel(entry.id)}</span>
          </li>
        ))}
      </ul>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <p className="max-w-sm rounded-2xl bg-[#fffaf3]/92 px-3 py-2 text-xs leading-relaxed text-[#3f3a33]">
          Scroll to zoom. Drag to turn. Right-drag to slide the map. Stay above the land.
        </p>
        <div className="pointer-events-auto">
          <Button type="button" size="sm" variant="outline" onClick={() => resetRef.current()}>
            High view
          </Button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <div className="flex items-center gap-2 rounded-2xl bg-[#fffaf3]/95 px-3 py-2 text-sm text-[#1c1915] shadow-sm">
          <span ref={swatch} className="size-4 shrink-0 rounded-sm border border-[#1c1915]/15" />
          <span ref={name}>Hover a block</span>
        </div>
        <p className="rounded-2xl bg-[#fffaf3]/95 px-3 py-2 font-mono text-xs tabular-nums text-[#1c1915]">
          <span className="mr-2 font-sans text-[#6d675e]">{timeLabel(world.settings.timeOfDay)}</span>
          <span ref={place} />
        </p>
      </div>
    </div>
  );
}
