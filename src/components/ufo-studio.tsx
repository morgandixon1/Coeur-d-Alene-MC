"use client";

import { useState } from "react";
import Link from "next/link";
import { UfoPreview } from "@/components/ufo-preview";
import { conditionLabel, hullsFor, UFO_CIVILIZATIONS, UFO_CONDITIONS, UFO_HULLS, type UfoCivilization, type UfoRequest } from "@/lib/ufos/catalog";
import { generateUfo } from "@/lib/ufos/generate";

const FIRST_UFO = generateUfo({ hull: "saucer", condition: "landed", seed: 71342 });
const inputClass = "mt-1.5 w-full rounded-lg border border-white/15 bg-[#141f24] px-3 py-2.5 text-sm text-[#edf5ec]";

export function UfoStudio() {
  const [civilization, setCivilization] = useState(FIRST_UFO.civilization);
  const [hull, setHull] = useState<NonNullable<UfoRequest["hull"]>>(FIRST_UFO.hull);
  const [condition, setCondition] = useState<NonNullable<UfoRequest["condition"]>>(FIRST_UFO.condition);
  const [seed, setSeed] = useState("");
  const [craft, setCraft] = useState(FIRST_UFO);
  const [deck, setDeck] = useState<number | null>(null);
  const rooms = deck === null ? undefined : craft.decks[deck].rooms;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ufos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ civilization: craft.civilization, hull: craft.hull, condition: craft.condition, seed: craft.seed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not export the UFO world.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `ufo-${craft.hull}-${craft.condition}-${craft.seed}.mcworld`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the UFO world.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#121b22] font-[system-ui,sans-serif] text-[#edf5ec] md:grid md:h-dvh md:grid-cols-[290px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 border-white/10 bg-[#1a272c] p-5 sm:p-7 md:overflow-y-auto md:border-r">
        <header>
          <Link href="/" className="text-xs font-medium text-[#b6c5bd] hover:text-white">← Spawnwright</Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">UFO Studio</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#b6c5bd]">Generate voxel spacecraft and crash sites for Minecraft Bedrock.</p>
        </header>

        <form className="grid gap-3.5" onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const next = generateUfo({ civilization, hull, condition, seed: seed === "" ? undefined : Number(seed) });
          setCraft(next);
          if (deck !== null && deck >= next.decks.length) setDeck(null);
        }}>
          <label className="text-xs font-semibold">Civilization
            <select className={inputClass} value={civilization} onChange={(event) => {
              const next = event.target.value as UfoCivilization;
              setCivilization(next);
              setHull(hullsFor(next)[0]);
            }}>
              {Object.entries(UFO_CIVILIZATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">{civilization === "blight" ? "Asteroid" : "Hull"}
            <select className={inputClass} value={hull} onChange={(event) => setHull(event.target.value as typeof hull)}>
              {hullsFor(civilization).map((id) => <option key={id} value={id}>{UFO_HULLS[id]}</option>)}
              <option value="any">{civilization === "blight" ? "Random asteroid" : "Random hull"}</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Condition
            <select className={inputClass} value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)}>
              {(Object.keys(UFO_CONDITIONS) as (keyof typeof UFO_CONDITIONS)[]).map((id) => <option key={id} value={id}>{conditionLabel(civilization, id)}</option>)}
              <option value="any">Random condition</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Seed <span className="font-normal text-[#b6c5bd]">(optional)</span>
            <input className={inputClass} type="number" min={0} max={0xffffffff} step={1}
              placeholder="Random seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
          <button type="submit" className="rounded-lg bg-[#b8e8bd] px-3 py-2.5 text-sm font-semibold text-[#12271d] hover:bg-[#cdf4d1]">{civilization === "blight" ? "Generate asteroid" : "Generate UFO"}</button>
        </form>

        <div className="border-y border-white/10 py-4" aria-live="polite">
          <h2 className="text-lg font-semibold">{UFO_HULLS[craft.hull]}</h2>
          <p className="mt-1 text-sm text-[#b6c5bd]">{UFO_CIVILIZATIONS[craft.civilization]} · {conditionLabel(craft.civilization, craft.condition)} · {craft.width} × {craft.length} blocks</p>
          <p className="mt-1 text-xs text-[#b6c5bd]">{craft.decks.length} {craft.civilization === "blight" ? "cave levels" : "decks"} · {craft.decks.reduce((count, level) => count + level.rooms.length, 0)} {craft.civilization === "blight" ? "caverns" : "rooms"}{craft.entrances && ` · ${craft.entrances.length} concealed entrances`}</p>
          <button type="button" title="Reuse the current craft settings and seed"
            className="mt-2 font-mono text-xs text-[#b8e8bd] underline underline-offset-4"
            onClick={() => { setCivilization(craft.civilization); setHull(craft.hull); setCondition(craft.condition); setSeed(String(craft.seed)); }}>
            Seed {craft.seed}
          </button>
        </div>

        <button type="button" disabled={saving} onClick={() => { void download(); }}
          className="rounded-lg border border-white/25 px-3 py-2.5 text-sm font-semibold hover:bg-white/10 disabled:opacity-60">
          {saving ? "Packing world…" : "Download .mcworld"}
        </button>
        {error && <p role="alert" className="text-sm text-[#ffb1a3]">{error}</p>}
      </aside>

      <section className="relative h-[62dvh] min-h-96 overflow-hidden md:h-full">
        <UfoPreview craft={craft} deck={deck} />
        <div role="group" aria-label="Preview mode" className="absolute top-4 left-4 flex max-w-[calc(100%-2rem)] flex-wrap gap-1 rounded-lg border border-white/15 bg-[#141f24] p-1 sm:top-6 sm:left-6">
          {[{ label: "Exterior", mode: null }, ...craft.decks.map(({ name }, index) => ({ label: name, mode: index }))]
            .map(({ label, mode }) => (
            <button key={label} type="button" aria-pressed={deck === mode}
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-white/10 aria-pressed:bg-[#d5ebd8] aria-pressed:text-[#142925]"
              onClick={() => setDeck(mode)}>{label}</button>
          ))}
        </div>
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex flex-wrap items-end justify-between gap-2 text-xs text-[#cedbd3] sm:right-6 sm:bottom-6 sm:left-6">
          {rooms && <p className="max-w-xl rounded-md bg-[#141f24]/90 px-3 py-2">
            {rooms.map((room) => room.breached ? `${room.name} (breached)` : room.name).join(" · ")}
          </p>}
          <p className="ml-auto rounded-md bg-[#141f24]/90 px-3 py-2">Drag to orbit · Scroll to zoom · Right-drag to pan</p>
        </div>
      </section>
    </main>
  );
}
