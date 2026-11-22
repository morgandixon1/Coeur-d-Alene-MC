"use client";

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, InstancedMesh, Matrix4,
  MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BLOCKS, Block, type BlockId } from "@/lib/blocks";
import type { Ufo } from "@/lib/ufos/generate";
import { columnKey } from "@/lib/ufos/scene";
import type { Voxel } from "@/lib/voxels";

export function UfoPreview({ craft, deck }: { craft: Ufo; deck: number | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      setError(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const xenos = craft.civilization === "xenos";
    const asteroid = craft.civilization === "blight";
    renderer.setClearColor(asteroid ? "#151d18" : xenos ? "#221820" : "#121b22");
    node.replaceChildren(renderer.domElement);

    const interior = deck !== null;
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 8;
    controls.maxDistance = 250;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;

    const groups = new Map<BlockId, Voxel[]>();
    const elevation = asteroid && !interior ? new Map<string, number>() : undefined;
    for (const voxel of interior ? craft.decks[deck].cutaway : craft.exterior) {
      if (elevation) {
        const key = columnKey(voxel.x, voxel.z);
        elevation.set(key, Math.max(voxel.y, elevation.get(key) ?? -64));
      }
      const group = groups.get(voxel.block);
      if (group) group.push(voxel);
      else groups.set(voxel.block, [voxel]);
    }

    const unit = new BoxGeometry(1, 1, 1);
    const matrix = new Matrix4();
    const shade = new Color();
    const meshes: InstancedMesh<BoxGeometry, MeshLambertMaterial>[] = [];
    for (const [block, voxels] of groups) {
      const def = BLOCKS[block];
      const [r, g, b] = def.color;
      const color = new Color().setRGB(r / 255, g / 255, b / 255, "srgb");
      const glass = block === Block.Glass;
      const material = new MeshLambertMaterial({
        color,
        emissive: def.bright ? color : undefined,
        emissiveIntensity: 0.45,
        transparent: glass,
        opacity: glass ? 0.45 : 1,
        depthWrite: !glass,
      });
      const mesh = new InstancedMesh(unit, material, voxels.length);
      if (glass) mesh.renderOrder = 1;
      for (const [i, { x, y, z }] of voxels.entries()) {
        mesh.setMatrixAt(i, matrix.makeTranslation(x, y + 0.5, z));
        if (elevation) {
          // Darken ground enclosed by taller rock to make the impact bowls readable.
          const rises = [columnKey(x + 4, z), columnKey(x - 4, z), columnKey(x, z + 4), columnKey(x, z - 4)]
            .map((key) => (elevation.get(key) ?? y) - y)
            .sort((a, b) => b - a);
          const enclosure = Math.max(0, rises[2]);
          const light = 1 - Math.min(0.42, enclosure * 0.09);
          mesh.setColorAt(i, shade.setRGB(light, light, light));
        }
      }
      meshes.push(mesh);
      scene.add(mesh);
    }

    scene.add(new AmbientLight("#ddebf0", 1.25));
    const sun = new DirectionalLight("#fff0d5", 1.75);
    sun.position.set(-18, 30, 14);
    scene.add(sun);

    const fitCutaway = interior && (deck === 1 || asteroid);
    const span = fitCutaway
      ? Math.max(10, ...craft.decks[deck].cutaway.map(({ x, z }) => Math.max(Math.abs(x), Math.abs(z)))) * 2 + 3
      : Math.max(craft.width, craft.length);
    const landed = craft.condition === "landed";
    const targetY = interior ? (craft.decks[deck].floorY ?? (deck * 5 + (landed ? 4 : 0))) + 2
      : asteroid ? (craft.condition === "impact" ? 5 : 11) : landed ? 6 : 2;
    const skid = asteroid && !interior && craft.condition === "skid";
    const direction = new Vector3(interior ? 0.19 : 0.79, interior ? 2.5 : skid ? 1.4 : 1.05, xenos || skid ? -1 : 1).normalize();
    controls.target.set(craft.condition === "exploded" && !interior ? 3 : 0, targetY, skid ? -13 : 0);
    let firstDraw = true;
    const draw = () => renderer.render(scene, camera);
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = node;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (firstDraw) {
        firstDraw = false;
        const framing = interior ? (asteroid ? 1.44 : deck === 1 ? 1.52 : 1.26)
          : skid ? 2.12 : landed ? 1.62 : 1.8;
        const distance = Math.min(controls.maxDistance, span * framing / Math.min(1, camera.aspect));
        camera.position.copy(controls.target).addScaledVector(direction, distance);
        controls.update();
      }
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    controls.addEventListener("change", draw);

    return () => {
      observer.disconnect();
      controls.removeEventListener("change", draw);
      controls.dispose();
      for (const mesh of meshes) {
        mesh.material.dispose();
        mesh.dispose();
      }
      unit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [craft, deck]);

  return (
    <>
      <div className="absolute inset-0 [&>canvas]:touch-none" ref={holder}
        aria-label={deck === null ? "Interactive UFO exterior" : `Interactive cutaway of the ${craft.decks[deck].name.toLowerCase()}`} />
      {error && <p className="absolute inset-0 grid place-items-center p-8 text-center text-slate-300">
        The 3D preview needs WebGL. You can still generate and download a world.
      </p>}
    </>
  );
}
