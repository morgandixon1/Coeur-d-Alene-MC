"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BLOCKS, Block, blockLabel, blockSwatch, type BlockId } from "@/lib/blocks";
import { getBlockTexture, type TextureMode } from "@/lib/block-textures";
import { generateCommercialBatch } from "@/lib/commercial/batch";
import {
  COMMERCIAL_ERAS,
  COMMERCIAL_SCALES,
  COMMERCIAL_STORE_TYPES,
  COMMERCIAL_TYPES,
  supportsScale,
  type CommercialEra,
  type CommercialMaterialOverrides,
  type CommercialScale,
  type CommercialStoreType,
  type CommercialType,
} from "@/lib/commercial/catalog";
import { generateCommercial, type CommercialBuilding } from "@/lib/commercial/generate";

const FIRST_BUILDING = generateCommercial({
  type: "sherman_storefront",
  era: "historic",
  scale: "medium",
  storeType: "grocery",
  seed: 40317,
});

const inputClass = "mt-1 w-full rounded-lg border border-[#d6d9cf] bg-[#fafbf7] px-3 py-2 text-sm text-[#182d27]";
const chipClass = "rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium";

const MATERIAL_CHOICES: readonly BlockId[] = [
  Block.WhiteConcrete,
  Block.LightGrayConcrete,
  Block.GrayConcrete,
  Block.BlackConcrete,
  Block.StoneBricks,
  Block.Stone,
  Block.Cobblestone,
  Block.Clay,
  Block.Basalt,
  Block.RoofTiles,
  Block.Quartz,
  Block.Brick,
  Block.RedTerracotta,
  Block.OrangeTerracotta,
  Block.YellowTerracotta,
  Block.WhiteTerracotta,
  Block.BrownTerracotta,
  Block.GreenTerracotta,
  Block.Sandstone,
  Block.RedSandstone,
];

const TEXTURE_MODES: readonly { id: TextureMode; label: string }[] = [
  { id: "pixel", label: "Pixel textures" },
  { id: "smooth", label: "Smooth siding" },
  { id: "flat", label: "Flat color" },
];

function CommercialPreview({
  building,
  floor,
  massing = false,
  textureMode = "pixel",
}: {
  building: CommercialBuilding;
  floor: number | null;
  massing?: boolean;
  textureMode?: TextureMode;
}) {
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
    renderer.setClearColor(new Color("#182b30"));
    node.replaceChildren(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.1, 450);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 6;
    controls.maxDistance = 160;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const selected = floor === null ? null : building.floors[floor];
    const byBlock = new Map<BlockId, CommercialBuilding["blocks"]>();
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    let top = 0;

    for (const block of building.blocks) {
      if (selected && (block.y < selected.floorY || block.y >= selected.cutY)) continue;
      if (massing) continue;
      if (!byBlock.has(block.block)) byBlock.set(block.block, []);
      byBlock.get(block.block)!.push(block);
      minX = Math.min(minX, block.x);
      maxX = Math.max(maxX, block.x);
      minZ = Math.min(minZ, block.z);
      maxZ = Math.max(maxZ, block.z);
      top = Math.max(top, block.y);
    }

    if (massing) {
      minX = Math.min(...building.plan.envelopes.map((e) => e.x));
      maxX = Math.max(...building.plan.envelopes.map((e) => e.x + e.w));
      minZ = Math.min(...building.plan.envelopes.map((e) => e.z));
      maxZ = Math.max(...building.plan.envelopes.map((e) => e.z + e.d));
      top = Math.max(...building.plan.envelopes.map((e) => e.stories * building.plan.storyHeight));
    }

    const unit = new BoxGeometry(1, 1, 1);
    const meshes: InstancedMesh[] = [];
    for (const [id, blocks] of byBlock) {
      const def = BLOCKS[id];
      const [r, g, b] = def.color;
      const isGlass = id === Block.Glass;
      const map = getBlockTexture(id, textureMode);
      const material = new MeshLambertMaterial({
        map: map ?? undefined,
        color: map ? new Color(0xffffff) : new Color().setRGB(r / 255, g / 255, b / 255, "srgb"),
        transparent: isGlass,
        opacity: isGlass ? (map ? 1 : 0.34) : 1,
        depthWrite: !isGlass,
        emissive: def.bright ? new Color("#9d7846") : undefined,
      });
      const stairs =
        id === Block.OakStairNorth ||
        id === Block.OakStairSouth ||
        id === Block.OakStairWest ||
        id === Block.OakStairEast;
      const isHangingSign = id === Block.HangingSign;
      const isArmorStand = id === Block.ArmorStand;
      const isCurtain = id === Block.CurtainBanner;
      const instancesPerBlock = stairs ? 2 : isHangingSign ? 3 : isArmorStand ? 4 : 1;
      const mesh = new InstancedMesh(unit, material, blocks.length * instancesPerBlock);
      if (isGlass) mesh.renderOrder = 1;
      const matrix = new Matrix4();
      for (const [i, block] of blocks.entries()) {
        if (stairs) {
          mesh.setMatrixAt(i * 2, matrix.makeScale(1, 0.5, 1).setPosition(block.x, block.y + 0.25, block.z));
          const west = id === Block.OakStairWest;
          const east = id === Block.OakStairEast;
          const ew = west || east;
          mesh.setMatrixAt(
            i * 2 + 1,
            matrix
              .makeScale(ew ? 0.5 : 1, 0.5, ew ? 1 : 0.5)
              .setPosition(
                block.x + (east ? 0.25 : west ? -0.25 : 0),
                block.y + 0.75,
                block.z + (ew ? 0 : id === Block.OakStairNorth ? -0.25 : 0.25),
              ),
          );
        } else if (isHangingSign) {
          // Sign board + two vertical chains reaching up to the ceiling
          mesh.setMatrixAt(i * 3, matrix.makeScale(0.84, 0.54, 0.14).setPosition(block.x, block.y + 0.35, block.z));
          mesh.setMatrixAt(i * 3 + 1, matrix.makeScale(0.08, 0.75, 0.08).setPosition(block.x - 0.3, block.y + 0.95, block.z));
          mesh.setMatrixAt(i * 3 + 2, matrix.makeScale(0.08, 0.75, 0.08).setPosition(block.x + 0.3, block.y + 0.95, block.z));
        } else if (isArmorStand) {
          // Base plate + upright post + shoulder crossbar + head peg
          mesh.setMatrixAt(i * 4, matrix.makeScale(0.7, 0.12, 0.7).setPosition(block.x, block.y + 0.06, block.z));
          mesh.setMatrixAt(i * 4 + 1, matrix.makeScale(0.18, 1.45, 0.18).setPosition(block.x, block.y + 0.8, block.z));
          mesh.setMatrixAt(i * 4 + 2, matrix.makeScale(0.82, 0.16, 0.16).setPosition(block.x, block.y + 1.35, block.z));
          mesh.setMatrixAt(i * 4 + 3, matrix.makeScale(0.32, 0.32, 0.32).setPosition(block.x, block.y + 1.68, block.z));
        } else if (isCurtain) {
          // Hanging curtain banner draping down across the changing room opening
          mesh.setMatrixAt(i, matrix.makeScale(0.88, 1.55, 0.08).setPosition(block.x, block.y + 0.2, block.z));
        } else {
          const [sx, sy, sz] = def.scale ?? [1, 1, 1];
          mesh.setMatrixAt(i, matrix.makeScale(sx, sy, sz).setPosition(block.x, block.y + sy / 2, block.z));
        }
      }
      scene.add(mesh);
      meshes.push(mesh);
    }

    if (massing) {
      const storyHeight = building.plan.storyHeight;
      const occupied = new Set<string>();
      for (const [i, e] of building.plan.envelopes.entries()) {
        const columns: { x: number; z: number }[] = [];
        for (let x = e.x; x < e.x + e.w; x++) {
          for (let z = e.z; z < e.z + e.d; z++) {
            const k = `${x},${z}`;
            if (!occupied.has(k)) {
              occupied.add(k);
              columns.push({ x, z });
            }
          }
        }
        const material = new MeshLambertMaterial({ color: i === 0 ? "#cab99a" : "#6f8e80" });
        const mesh = new InstancedMesh(unit, material, columns.length);
        for (const [j, { x, z }] of columns.entries()) {
          mesh.setMatrixAt(
            j,
            new Matrix4().makeScale(1, e.stories * storyHeight, 1).setPosition(x, (e.stories * storyHeight) / 2, z),
          );
        }
        meshes.push(mesh);
        scene.add(mesh);
      }
    }

    scene.add(new AmbientLight("#e4edf1", 1.15));
    const sun = new DirectionalLight("#fff3db", 1.7);
    sun.position.set(-14, 28, 22);
    scene.add(sun);
    const grid = new GridHelper(110, 110, "#485b5a", "#304549");
    grid.position.y = (selected?.floorY ?? 0) - 1.02;
    scene.add(grid);

    const span = Math.max(maxX - minX, maxZ - minZ, top * 1.1, 12);
    const direction = new Vector3(selected ? 0.32 : 0.66, selected ? 1.8 : 0.62, 1).normalize();
    controls.target.set((maxX + minX) / 2, selected ? selected.floorY + 0.5 : top * 0.38, (maxZ + minZ) / 2);

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = node;
      if (width < 1 || height < 1) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.render(scene, camera);
    };
    resize();
    camera.position.copy(controls.target).addScaledVector(direction, (span * 1.43) / Math.min(1, camera.aspect));
    controls.update();

    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const draw = () => renderer.render(scene, camera);
    controls.addEventListener("change", draw);
    draw();

    return () => {
      observer.disconnect();
      controls.removeEventListener("change", draw);
      controls.dispose();
      unit.dispose();
      grid.dispose();
      for (const mesh of meshes) {
        mesh.dispose();
        (mesh.material as MeshLambertMaterial).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [building, floor, massing, textureMode]);

  return (
    <>
      <div ref={holder} className="absolute inset-0 [&>canvas]:touch-none" aria-label="Interactive Minecraft commercial building model" />
      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-[#e0eae3]">
          3D preview needs WebGL. Commercial building generation and world downloads are still available.
        </div>
      )}
    </>
  );
}

export function CommercialStudio() {
  const [type, setType] = useState<CommercialType>("sherman_storefront");
  const [storeType, setStoreType] = useState<CommercialStoreType>("grocery");
  const [era, setEra] = useState<CommercialEra>("historic");
  const [scale, setScale] = useState<CommercialScale>("medium");
  const [seed, setSeed] = useState("");
  const [building, setBuilding] = useState<CommercialBuilding>(FIRST_BUILDING);
  const [floor, setFloor] = useState<number | null>(null);
  const [massing, setMassing] = useState(false);
  const [textureMode, setTextureMode] = useState<TextureMode>("pixel");
  const [gallery, setGallery] = useState<CommercialBuilding[]>([]);
  const [galleryFloor, setGalleryFloor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty =
    type !== building.request.type ||
    storeType !== (building.request.storeType ?? "any") ||
    era !== building.request.era ||
    scale !== building.request.scale ||
    (seed !== "" && Number(seed) !== building.seed);

  function updateMaterial(slot: keyof CommercialMaterialOverrides, blockId: BlockId) {
    const nextMaterials: CommercialMaterialOverrides = {
      ...(building.request.materials ?? {}),
      [slot]: blockId,
    };
    setBuilding(generateCommercial({ ...building.request, materials: nextMaterials }));
  }

  function resetMaterials() {
    const { materials: _unused, ...baseRequest } = building.request;
    void _unused;
    setBuilding(generateCommercial(baseRequest));
  }

  function generate() {
    setError("");
    const value = seed.trim() ? Number(seed) : undefined;
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
      setError("Use a whole-number seed from 0 to 4294967295.");
      return;
    }
    try {
      setBuilding(generateCommercial({ type, storeType, era, scale, seed: value }));
      setFloor(null);
      setMassing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a commercial building.");
    }
  }

  async function download() {
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/commercial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(building.request),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.error ?? "Could not export the world.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `commercial-${building.seed}.mcworld`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the world.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#e7eae0] text-[#172d27] lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-full lg:min-h-0 lg:grid-cols-[minmax(300px,355px)_1fr]">
        <aside className="flex flex-col gap-4 border-r border-[#cad0c4] bg-[#f5f5ed] p-5 lg:overflow-y-auto">
          <header>
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#426253]">
              <Link href="/" className="hover:underline">← Spawnwright</Link>
              <Link href="/houses" className="hover:underline">House studio →</Link>
            </div>
            <p className="mt-3 text-[10px] font-semibold tracking-[0.22em] text-[#567264] uppercase">
              North Idaho · Commercial studio
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Coeur d’Alene commercial</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4e6258]">
              Roll furnished Minecraft commercial buildings, from Sherman Ave brick storefronts to Riverstone offices and warehouses.
            </p>
          </header>

          <form
            className="grid gap-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              generate();
            }}
          >
            <label className="text-xs font-semibold">
              Building type
              <select
                className={inputClass}
                value={type}
                onChange={(event) => {
                  const next = event.target.value as CommercialType;
                  setType(next);
                  if (!supportsScale(next, scale)) setScale("any");
                }}
              >
                {Object.entries(COMMERCIAL_TYPES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold">
              Store type
              <select
                className={inputClass}
                value={storeType}
                onChange={(event) => setStoreType(event.target.value as CommercialStoreType)}
              >
                {Object.entries(COMMERCIAL_STORE_TYPES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">
                Era
                <select
                  className={inputClass}
                  value={era}
                  onChange={(event) => setEra(event.target.value as CommercialEra)}
                >
                  {Object.entries(COMMERCIAL_ERAS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {id === "any" ? "Any era" : label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold">
                Scale
                <select
                  className={inputClass}
                  value={scale}
                  onChange={(event) => setScale(event.target.value as CommercialScale)}
                >
                  {Object.entries(COMMERCIAL_SCALES)
                    .filter(([id]) => supportsScale(type, id as CommercialScale))
                    .map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className="text-xs font-semibold">
              Seed <span className="font-normal text-[#52685b]">(optional)</span>
              <input
                className={inputClass}
                type="number"
                min="0"
                max="4294967295"
                step="1"
                placeholder="Random seed"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                className="rounded-lg bg-[#234e40] px-3 py-2 text-sm font-semibold text-white hover:bg-[#306453]"
              >
                Generate building
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm font-semibold hover:bg-[#e5eee4]"
                onClick={() => {
                  const mix = { type: "any", storeType: "any", era: "any", scale: "any" } as const;
                  setType(mix.type);
                  setStoreType(mix.storeType);
                  setEra(mix.era);
                  setScale(mix.scale);
                  setSeed("");
                  setError("");
                  setFloor(null);
                  setMassing(false);
                  setBuilding(generateCommercial(mix));
                }}
              >
                Roll CdA mix
              </button>
            </div>

            <button
              type="button"
              className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm font-semibold hover:bg-[#e5eee4]"
              onClick={() => {
                try {
                  setError("");
                  setGalleryFloor(false);
                  setGallery(generateCommercialBatch({ type, storeType, era, scale }));
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not generate a review batch.");
                }
              }}
            >
              Compare 6 designs
            </button>
          </form>

          <div className="rounded-xl border border-[#d6d9cf] bg-[#fbfcf6] p-3.5">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#567264] uppercase">Current building</p>
            <h2 className="mt-1 text-lg leading-tight font-semibold">{building.title}</h2>
            <p className="mt-1 text-xs text-[#4e6258]">
              {building.badge} · {building.specs}
            </p>
            <button
              type="button"
              title="Reuse the settings and seed for this building"
              className="mt-2 text-xs text-[#426253] underline underline-offset-2"
              onClick={() => {
                setType(building.request.type ?? "any");
                setStoreType(building.request.storeType ?? "any");
                setEra(building.request.era ?? "any");
                setScale(building.request.scale ?? "any");
                setSeed(String(building.seed));
              }}
            >
              Seed {building.seed}
            </button>
            {dirty && <p className="mt-2 text-xs text-[#755025]">Settings changed. Generate to update the preview.</p>}

            <details open className="mt-3 border-t border-[#e3e6dc] pt-2">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold">
                <span>Block materials</span>
                {building.request.materials && (
                  <button
                    type="button"
                    className="font-normal text-[#426253] underline underline-offset-2"
                    onClick={(e) => {
                      e.preventDefault();
                      resetMaterials();
                    }}
                  >
                    Reset
                  </button>
                )}
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ["wall", "Wall"],
                    ["accent", "Accent"],
                    ["trim", "Trim"],
                    ["roof", "Roof"],
                  ] as const
                ).map(([slot, label]) => {
                  const current = building.materials[slot];
                  return (
                    <label key={slot} className="text-[11px] font-medium text-[#4e6258]">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-xs border border-black/20"
                          style={{ background: blockSwatch(current) }}
                        />
                        {label}
                      </span>
                      <select
                        className="mt-1 w-full rounded-md border border-[#d6d9cf] bg-[#fafbf7] px-2 py-1 text-xs text-[#182d27]"
                        value={current}
                        onChange={(e) => updateMaterial(slot, Number(e.target.value) as BlockId)}
                      >
                        {MATERIAL_CHOICES.map((id) => (
                          <option key={id} value={id}>
                            {blockLabel(id)}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </details>

            <details className="mt-3 border-t border-[#e3e6dc] pt-2">
              <summary className="cursor-pointer text-xs font-semibold">
                {building.chests.length} stocked chests
              </summary>
              <ul className="mt-2 space-y-2 text-xs text-[#4e6258]">
                {building.chests.map((chest) => (
                  <li key={`${chest.x},${chest.y},${chest.z}`}>
                    <strong className="block text-[#263e34]">{chest.label}</strong>
                    {chest.items.map((item) => `${item.count} × ${item.name.split(":")[1].replaceAll("_", " ")}`).join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void download();
            }}
            className="rounded-lg border border-[#9bb0a4] px-4 py-2 text-sm font-semibold hover:bg-[#e5eee4] disabled:opacity-60"
          >
            {saving ? "Packing world…" : "Download current .mcworld"}
          </button>
          {error && (
            <p role="alert" className="text-sm text-[#a0382b]">
              {error}
            </p>
          )}
        </aside>

        <section className="relative order-first h-[52dvh] min-h-80 bg-[#182b30] text-[#edf4ed] lg:order-none lg:h-full">
          <CommercialPreview
            key={`${building.seed}-${building.type}-${building.storeType}-${building.era}-${building.scale}`}
            building={building}
            floor={floor}
            massing={massing}
            textureMode={textureMode}
          />
          <div className="absolute top-4 left-4 flex flex-wrap gap-1.5" aria-label="Preview mode">
            <button
              type="button"
              aria-pressed={floor === null && !massing}
              className={`${chipClass} ${floor === null && !massing ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`}
              onClick={() => {
                setFloor(null);
                setMassing(false);
              }}
            >
              Exterior
            </button>
            <button
              type="button"
              aria-pressed={massing}
              className={`${chipClass} ${massing ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`}
              onClick={() => {
                setFloor(null);
                setMassing(true);
              }}
            >
              Building shape
            </button>
            {building.floors.map((level, index) => (
              <button
                key={level.floorY}
                type="button"
                aria-pressed={floor === index}
                className={`${chipClass} ${floor === index ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`}
                onClick={() => {
                  setFloor(index);
                  setMassing(false);
                }}
              >
                Floor {index + 1}
              </button>
            ))}
          </div>

          {!massing && (
            <div className="absolute top-4 right-4 flex flex-wrap gap-1.5" aria-label="Block texture style">
              {TEXTURE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={textureMode === mode.id}
                  className={`${chipClass} ${textureMode === mode.id ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`}
                  onClick={() => setTextureMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}

          <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex flex-wrap items-end justify-between gap-2 text-xs text-[#e0eae3]">
            {floor !== null && (
              <p className="rounded-md bg-[#182b30]/85 px-2.5 py-1.5">{building.floors[floor]!.rooms.join(" · ")}</p>
            )}
            <p className="ml-auto rounded-md bg-[#182b30]/85 px-2.5 py-1.5">
              Drag to orbit · Scroll to zoom · Right-drag to pan
            </p>
          </div>
        </section>
      </div>

      {gallery.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Compare commercial designs"
          className="fixed inset-0 z-50 overflow-y-auto bg-[#eef0e8] p-4 text-[#172d27]"
        >
          <div className="mx-auto max-w-7xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Same brief. Different commercial buildings.</h2>
                <p className="text-sm text-[#52685b]">
                  {COMMERCIAL_TYPES[type]} · {COMMERCIAL_STORE_TYPES[storeType]} · {COMMERCIAL_ERAS[era]} · {COMMERCIAL_SCALES[scale]} · Select a design to inspect its spaces.
                </p>
              </div>
              <button
                className="rounded-lg border border-[#9bb0a4] px-4 py-2"
                onClick={() => setGallery([])}
              >
                Close comparison
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm"
                onClick={() => setGalleryFloor(!galleryFloor)}
              >
                {galleryFloor ? "Compare exteriors" : "Compare floor plans"}
              </button>
              <button
                className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm"
                onClick={() => {
                  try {
                    setGallery(generateCommercialBatch({ type, storeType, era, scale }));
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Could not generate a batch.");
                    setGallery([]);
                  }
                }}
              >
                Another 6 designs
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {gallery.map((candidate) => (
                <article
                  key={candidate.seed}
                  className="overflow-hidden rounded-xl border border-[#ccd3c6] bg-[#fafbf5]"
                >
                  <div className="relative h-64 bg-[#182b30]">
                    <CommercialPreview
                      building={candidate}
                      floor={galleryFloor ? 0 : null}
                      textureMode={textureMode}
                    />
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold">{candidate.plan.family}</h3>
                    <p className="mt-1 text-xs text-[#52685b]">
                      {candidate.specs} · Seed {candidate.seed}
                    </p>
                    <button
                      className="mt-3 rounded-lg bg-[#234e40] px-4 py-2 text-sm text-white"
                      onClick={() => {
                        setBuilding(candidate);
                        setSeed("");
                        setFloor(null);
                        setMassing(false);
                        setGallery([]);
                      }}
                    >
                      Inspect this design
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
