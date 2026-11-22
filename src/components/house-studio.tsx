"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AmbientLight, BoxGeometry, Color, DirectionalLight, GridHelper, InstancedMesh, Matrix4, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BLOCKS, Block, type BlockId } from "@/lib/blocks";
import { HOUSE_ERAS, HOUSE_PRICES, HOUSE_STYLES, supportsTier, type HouseEra, type HousePrice, type HouseStyle } from "@/lib/houses/catalog";
import { generateHouseBatch } from "@/lib/houses/batch";
import { generateHouse, type House } from "@/lib/houses/generate";

const FIRST_HOUSE = generateHouse({ style: "suburban", era: "suburban90s", price: "mid", seed: 40317 });
const inputClass = "mt-1 w-full rounded-lg border border-[#d6d9cf] bg-[#fafbf7] px-3 py-2 text-sm text-[#182d27]";
const chipClass = "rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium";

function HousePreview({ house, floor, massing = false }: { house: House; floor: number | null; massing?: boolean }) {
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
    const camera = new PerspectiveCamera(42, 1, 0.1, 350);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 5;
    controls.maxDistance = 125;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const selected = floor === null ? null : house.floors[floor];
    const byBlock = new Map<BlockId, House["blocks"]>();
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0, top = 0;
    for (const block of house.blocks) {
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
      minX=Math.min(...house.plan.envelopes.map(e=>e.x)); maxX=Math.max(...house.plan.envelopes.map(e=>e.x+e.w));
      minZ=Math.min(...house.plan.envelopes.map(e=>e.z)); maxZ=Math.max(...house.plan.envelopes.map(e=>e.z+e.d));
      top=Math.max(...house.plan.envelopes.map(e=>e.stories*4));
    }
    const unit = new BoxGeometry(1, 1, 1);
    const meshes: InstancedMesh[] = [];
    for (const [id, blocks] of byBlock) {
      const def = BLOCKS[id];
      const [r, g, b] = def.color;
      const isGlass = id === Block.Glass;
      const material = new MeshLambertMaterial({
        color: new Color().setRGB(r / 255, g / 255, b / 255, "srgb"),
        transparent: isGlass,
        opacity: isGlass ? 0.34 : 1,
        depthWrite: !isGlass,
        emissive: def.bright ? new Color("#9d7846") : undefined,
      });
      const stairs = id === Block.OakStairNorth || id === Block.OakStairSouth || id === Block.OakStairWest;
      const mesh = new InstancedMesh(unit, material, blocks.length * (stairs ? 2 : 1));
      if (isGlass) mesh.renderOrder = 1;
      const matrix = new Matrix4();
      for (const [i, block] of blocks.entries()) {
        if (stairs) {
          mesh.setMatrixAt(i * 2, matrix.makeScale(1, 0.5, 1).setPosition(block.x, block.y + 0.25, block.z));
          const west = id === Block.OakStairWest;
          mesh.setMatrixAt(i * 2 + 1, matrix.makeScale(west ? 0.5 : 1, 0.5, west ? 1 : 0.5)
            .setPosition(block.x - (west ? 0.25 : 0), block.y + 0.75, block.z + (west ? 0 : id === Block.OakStairNorth ? -0.25 : 0.25)));
        } else {
          const [sx, sy, sz] = def.scale ?? [1, 1, 1];
          mesh.setMatrixAt(i, matrix.makeScale(sx, sy, sz).setPosition(block.x, block.y + sy / 2, block.z));
        }
      }
      scene.add(mesh);
      meshes.push(mesh);
    }
    if (massing) {
      const occupied = new Set<string>();
      const storyHeight = house.style === "pnw_modern" || house.style === "pnw_lodge" ? 5 : 4;
      for (const [i,e] of house.plan.envelopes.entries()) {
        const columns: {x:number;z:number}[] = [];
        for(let x=e.x;x<e.x+e.w;x++) for(let z=e.z;z<e.z+e.d;z++) {
          const key=`${x},${z}`;
          if(!occupied.has(key)) {occupied.add(key);columns.push({x,z});}
        }
        const material = new MeshLambertMaterial({color:i===0?"#cab99a":"#6f8e80"});
        const mesh = new InstancedMesh(unit,material,columns.length);
        for(const [j,{x,z}] of columns.entries()) mesh.setMatrixAt(j,new Matrix4().makeScale(1,e.stories*storyHeight,1).setPosition(x,e.stories*storyHeight/2,z));
        meshes.push(mesh);scene.add(mesh);
      }
    }
    scene.add(new AmbientLight("#e4edf1", 1.15));
    const sun = new DirectionalLight("#fff3db", 1.7);
    sun.position.set(-12, 24, 18);
    scene.add(sun);
    const grid = new GridHelper(92, 92, "#485b5a", "#304549");
    grid.position.y = (selected?.floorY ?? 0) - 1.02;
    scene.add(grid);

    const span = Math.max(maxX - minX, maxZ - minZ, 10);
    const direction = new Vector3(selected ? 0.32 : 0.66, selected ? 1.8 : 0.65, 1).normalize();
    controls.target.set((maxX + minX) / 2, selected ? selected.floorY + 0.5 : top * 0.37, (maxZ + minZ) / 2);
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = node;
      if (width < 1 || height < 1) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.render(scene, camera);
    };
    resize();
    camera.position.copy(controls.target).addScaledVector(direction, span * 1.43 / Math.min(1, camera.aspect));
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
  }, [house, floor, massing]);

  return (
    <>
      <div ref={holder} className="absolute inset-0 [&>canvas]:touch-none" aria-label="Interactive Minecraft house model" />
      {error && <div className="absolute inset-0 grid place-items-center p-8 text-center text-[#e0eae3]">3D preview needs WebGL. House generation and world downloads are still available.</div>}
    </>
  );
}

export function HouseStudio() {
  const [style, setStyle] = useState<HouseStyle>("suburban");
  const [era, setEra] = useState<HouseEra>("suburban90s");
  const [price, setPrice] = useState<HousePrice>("mid");
  const [seed, setSeed] = useState("");
  const [house, setHouse] = useState<House>(FIRST_HOUSE);
  const [floor, setFloor] = useState<number | null>(null);
  const [massing, setMassing] = useState(false);
  const [gallery, setGallery] = useState<House[]>([]);
  const [galleryFloor, setGalleryFloor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = style !== house.request.style || era !== house.request.era || price !== house.request.price || (seed !== "" && Number(seed) !== house.seed);

  function generate() {
    setError("");
    const value = seed.trim() ? Number(seed) : undefined;
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
      setError("Use a whole-number seed from 0 to 4294967295.");
      return;
    }
    try {
      setHouse(generateHouse({ style, era, price, seed: value }));
      setFloor(null);setMassing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not generate a house."); }
  }

  async function download() {
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/houses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(house.request),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not export the world.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `house-${house.seed}.mcworld`;
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
            <Link href="/" className="text-xs font-medium text-[#426253] hover:underline">← Spawnwright</Link>
            <p className="mt-3 text-[10px] font-semibold tracking-[0.22em] text-[#567264] uppercase">North Idaho · House studio</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Coeur d’Alene houses</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4e6258]">Roll furnished Minecraft homes from 1990 onward, from plain trailers to custom lake estates.</p>
          </header>
          <form className="grid gap-2.5" onSubmit={(event) => { event.preventDefault(); generate(); }}>
            <label className="text-xs font-semibold">Home style
              <select className={inputClass} value={style} onChange={(event) => {
                const next = event.target.value as HouseStyle;
                setStyle(next);
                if (!supportsTier(next, price)) setPrice("any");
              }}>
                {Object.entries(HOUSE_STYLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">Era
                <select className={inputClass} value={era} onChange={(event) => setEra(event.target.value as HouseEra)}>
                  {Object.entries(HOUSE_ERAS).map(([id, label]) => <option key={id} value={id}>{id === "any" ? "Any era" : label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">Home tier
                <select className={inputClass} value={price} onChange={(event) => setPrice(event.target.value as HousePrice)}>
                  {Object.entries(HOUSE_PRICES).filter(([id]) => supportsTier(style, id as HousePrice)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="text-xs font-semibold">Seed <span className="font-normal text-[#52685b]">(optional)</span>
              <input className={inputClass} type="number" min="0" max="4294967295" step="1" placeholder="Random seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="submit" className="rounded-lg bg-[#234e40] px-3 py-2 text-sm font-semibold text-white hover:bg-[#306453]">Generate house</button>
              <button type="button" className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm font-semibold hover:bg-[#e5eee4]" onClick={() => {
                const mix = { style: "any", era: "any", price: "any" } as const;
                setStyle(mix.style);
                setEra(mix.era);
                setPrice(mix.price);
                setSeed("");
                setError("");
                setFloor(null);
                setHouse(generateHouse(mix));
              }}>Roll CdA mix</button>
            </div>
            <button type="button" className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm font-semibold hover:bg-[#e5eee4]" onClick={() => {
              try { setError(""); setGalleryFloor(false); setGallery(generateHouseBatch({style,era,price})); }
              catch(cause) { setError(cause instanceof Error ? cause.message : "Could not generate a review batch."); }
            }}>Compare 6 designs</button>
          </form>
          <div className="rounded-xl border border-[#d6d9cf] bg-[#fbfcf6] p-3.5">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#567264] uppercase">Current house</p>
            <h2 className="mt-1 text-lg leading-tight font-semibold">{house.title}</h2>
            <p className="mt-1 text-xs text-[#4e6258]">{house.badge} · {house.specs}</p>
            <button type="button" title="Reuse the settings and seed for this house" className="mt-2 text-xs text-[#426253] underline underline-offset-2" onClick={() => {
              setStyle(house.request.style ?? "any");
              setEra(house.request.era ?? "any");
              setPrice(house.request.price ?? "any");
              setSeed(String(house.seed));
            }}>Seed {house.seed}</button>
            {dirty && <p className="mt-2 text-xs text-[#755025]">Settings changed. Generate to update the preview.</p>}
            <details className="mt-3 border-t border-[#e3e6dc] pt-2">
              <summary className="cursor-pointer text-xs font-semibold">{house.chests.length} stocked chests</summary>
              <ul className="mt-2 space-y-2 text-xs text-[#4e6258]">
                {house.chests.map((chest) => (
                  <li key={`${chest.x},${chest.y},${chest.z}`}><strong className="block text-[#263e34]">{chest.label}</strong>
                    {chest.items.map((item) => `${item.count} × ${item.name.split(":")[1].replaceAll("_", " ")}`).join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <button type="button" disabled={saving} onClick={() => { void download(); }} className="rounded-lg border border-[#9bb0a4] px-4 py-2 text-sm font-semibold hover:bg-[#e5eee4] disabled:opacity-60">
            {saving ? "Packing world…" : "Download current .mcworld"}
          </button>
          {error && <p role="alert" className="text-sm text-[#a0382b]">{error}</p>}
        </aside>
        <section className="relative order-first h-[52dvh] min-h-80 bg-[#182b30] text-[#edf4ed] lg:order-none lg:h-full">
          <HousePreview key={JSON.stringify(house.request)} house={house} floor={floor} massing={massing} />
          <div className="absolute top-4 left-4 flex flex-wrap gap-1.5" aria-label="Preview mode">
            <button type="button" aria-pressed={floor === null && !massing} className={`${chipClass} ${floor === null && !massing ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`} onClick={() => {setFloor(null);setMassing(false);}}>Exterior</button>
            <button type="button" aria-pressed={massing} className={`${chipClass} ${massing ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`} onClick={()=>{setFloor(null);setMassing(true);}}>Building shape</button>
            {house.floors.map((level, index) => (
              <button key={level.floorY} type="button" aria-pressed={floor === index} className={`${chipClass} ${floor === index ? "bg-[#edf4ed] text-[#172d27]" : "bg-[#182b30]/90"}`} onClick={() => {setFloor(index);setMassing(false);}}>
                Floor {index + 1}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex flex-wrap items-end justify-between gap-2 text-xs text-[#e0eae3]">
            {floor !== null && <p className="rounded-md bg-[#182b30]/85 px-2.5 py-1.5">{house.floors[floor].rooms.join(" · ")}</p>}
            <p className="ml-auto rounded-md bg-[#182b30]/85 px-2.5 py-1.5">Drag to orbit · Scroll to zoom · Right-drag to pan</p>
          </div>
        </section>
      </div>
      {gallery.length>0 && <div role="dialog" aria-modal="true" aria-label="Compare house designs" className="fixed inset-0 z-50 overflow-y-auto bg-[#eef0e8] p-4 text-[#172d27]">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div><h2 className="text-xl font-semibold">Same brief. Different houses.</h2><p className="text-sm text-[#52685b]">{HOUSE_STYLES[style]} · {HOUSE_ERAS[era]} · {HOUSE_PRICES[price]} · Select a design to inspect its rooms.</p></div>
            <button className="rounded-lg border border-[#9bb0a4] px-4 py-2" onClick={()=>setGallery([])}>Close comparison</button>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <button className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm" onClick={()=>setGalleryFloor(!galleryFloor)}>{galleryFloor ? "Compare exteriors" : "Compare floor plans"}</button>
            <button className="rounded-lg border border-[#9bb0a4] px-3 py-2 text-sm" onClick={()=>{
              try {setGallery(generateHouseBatch({style,era,price}));} catch(cause) {setError(cause instanceof Error?cause.message:"Could not generate a batch.");setGallery([]);}
            }}>Another 6 designs</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{gallery.map(candidate=><article key={candidate.seed} className="overflow-hidden rounded-xl border border-[#ccd3c6] bg-[#fafbf5]">
            <div className="relative h-64 bg-[#182b30]"><HousePreview house={candidate} floor={galleryFloor ? 0 : null}/></div>
            <div className="p-3"><h3 className="font-semibold">{candidate.plan.family}</h3><p className="mt-1 text-xs text-[#52685b]">{candidate.specs} · Seed {candidate.seed}</p>
              <button className="mt-3 rounded-lg bg-[#234e40] px-4 py-2 text-sm text-white" onClick={()=>{setHouse(candidate);setSeed("");setFloor(null);setMassing(false);setGallery([]);}}>Inspect this design</button>
            </div>
          </article>)}</div>
        </div>
      </div>}
    </main>
  );
}
