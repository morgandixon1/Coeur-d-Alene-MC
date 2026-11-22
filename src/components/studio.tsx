"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SETTINGS,
  DIFFICULTY_OPTIONS,
  fileNameFor,
  MODES,
  SIZES,
  SIZE_BLOCKS,
  THEMES,
  timeLabel,
  type Difficulty,
  type GameMode,
  type SizeId,
  type ThemeId,
  type WorldSettings,
} from "@/lib/settings";
import { blockLabel, blockSwatch } from "@/lib/blocks";
import { blockCensus, generateWorld } from "@/lib/terrain";

const WorldView = dynamic(() => import("@/components/world-view").then((mod) => mod.WorldView), {
  ssr: false,
  loading: () => (
    <div className="grid h-full min-h-[320px] place-items-center bg-[#d5e2ea] text-sm text-[#3f3a33]">
      Preparing the overlook…
    </div>
  ),
});

function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; name: string; detail?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
          >
            {option.name}
            {option.detail ? <span className="text-[0.7rem] opacity-70">{option.detail}</span> : null}
          </Button>
        );
      })}
    </div>
  );
}

export function Studio() {
  const [settings, setSettings] = useState<WorldSettings>(DEFAULT_SETTINGS);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const world = useMemo(() => generateWorld(settings), [settings]);
  const blocks = useMemo(() => blockCensus(world), [world]);

  function patch(partial: Partial<WorldSettings>) {
    setSaved(null);
    setError(null);
    setSettings((current) => ({ ...current, ...partial }));
  }

  async function download() {
    setExporting(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The world could not be packed.");
      }
      const blob = await response.blob();
      const header = response.headers.get("Content-Disposition") ?? "";
      const named = header.match(/filename="([^"]+)"/);
      const filename = named?.[1] || fileNameFor(settings.name);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setSaved(filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The world could not be packed.");
    } finally {
      setExporting(false);
    }
  }

  const achievementsOff = settings.gameMode === "creative" || settings.cheats;

  return (
    <div className="grid min-h-dvh grid-rows-[minmax(320px,52dvh)_auto] bg-[#f3ecdf] text-[#1c1915] lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
      <section className="relative min-h-[320px] lg:col-start-2 lg:row-start-1">
        <WorldView world={world} />
      </section>
      <aside className="flex max-h-none flex-col gap-5 overflow-y-auto border-[#e4d8c4] px-4 py-5 lg:col-start-1 lg:row-start-1 lg:max-h-dvh lg:border-r lg:px-5">
        <header>
          <p className="text-xs font-medium tracking-[0.16em] text-[#8a5a32] uppercase">Bedrock draft</p>
          <h1 className="font-heading mt-1 text-4xl tracking-tight text-[#234e45]">Spawnwright</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#4d473f]">
            Shape a meeting place, look down on the colors, then hand your group a{" "}
            <span className="font-medium">.mcworld</span> before anyone opens Minecraft.
          </p>
        </header>

        <div className="space-y-2">
          <Label htmlFor="world-name">World name</Label>
          <Input
            id="world-name"
            value={settings.name}
            maxLength={40}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>Place</Label>
          <div className="grid gap-2">
            {THEMES.map((theme) => {
              const selected = settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ theme: theme.id as ThemeId })}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-[#234e45] bg-[#234e45] text-[#f6f1e7]"
                      : "border-[#e4d8c4] bg-[#fffaf3] hover:border-[#234e45]/40"
                  }`}
                >
                  <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: theme.swatch }} />
                  <span>
                    <span className="block text-sm font-medium">{theme.name}</span>
                    <span className={`mt-0.5 block text-xs leading-relaxed ${selected ? "text-[#f6f1e7]/80" : "text-[#6d675e]"}`}>
                      {theme.blurb}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Size</Label>
          <ChoiceRow options={SIZES} value={settings.size} onChange={(size: SizeId) => patch({ size })} />
          <p className="text-xs text-[#6d675e]">
            {SIZE_BLOCKS[settings.size]} × {SIZE_BLOCKS[settings.size]} blocks are drafted. Past that edge is open grass
            the group can build on.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Game mode</Label>
            <ChoiceRow options={MODES} value={settings.gameMode} onChange={(gameMode: GameMode) => patch({ gameMode })} />
          </div>
          <div className="space-y-2">
            <Label>Difficulty</Label>
            <ChoiceRow
              options={DIFFICULTY_OPTIONS}
              value={settings.difficulty}
              onChange={(difficulty: Difficulty) => patch({ difficulty })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="seed">Seed</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => patch({ seed: Math.floor(Math.random() * 1_000_000) })}
            >
              Shuffle
            </Button>
          </div>
          <Input
            id="seed"
            inputMode="numeric"
            value={String(settings.seed)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next)) patch({ seed: next });
            }}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="time">Starts at {timeLabel(settings.timeOfDay).toLowerCase()}</Label>
            <span className="font-mono text-xs text-[#6d675e]">{settings.timeOfDay}</span>
          </div>
          <Slider
            id="time"
            min={0}
            max={24000}
            step={200}
            value={[settings.timeOfDay]}
            onValueChange={(value) => patch({ timeOfDay: value[0] ?? 0 })}
          />
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="freeze">Hold that time</Label>
            <Switch
              id="freeze"
              checked={settings.freezeTime}
              onCheckedChange={(checked) => patch({ freezeTime: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="cheats">Commands</Label>
              <p className="mt-1 text-xs text-[#6d675e]">Cheats, and creative mode, turn achievements off.</p>
            </div>
            <Switch id="cheats" checked={settings.cheats} onCheckedChange={(checked) => patch({ cheats: checked })} />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg">On the ground</h2>
            <Badge variant="secondary">
              meet {world.spawn.x}, {world.spawn.z}
            </Badge>
          </div>
          <ul className="space-y-1.5 text-sm leading-relaxed text-[#4d473f]">
            {world.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-[#6d675e]">
            Friendly damage is off, coordinates are on, and everyone joins in this game mode.
            {achievementsOff ? " Achievements stay off for this world." : ""}
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="font-heading text-lg">Block colors</h2>
          <p className="text-xs leading-relaxed text-[#6d675e]">
            Each swatch is the color in the overlook. Hover the map to name the block under the pointer. The download
            uses these same Bedrock block types.
          </p>
          <ul className="grid grid-cols-1 gap-1.5">
            {blocks.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-3.5 shrink-0 rounded-sm border border-[#1c1915]/15"
                  style={{ background: blockSwatch(entry.id) }}
                />
                <span className="min-w-0 flex-1 truncate">{blockLabel(entry.id)}</span>
                <span className="font-mono text-xs tabular-nums text-[#6d675e]">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <Button type="button" className="h-11 w-full text-base" disabled={exporting || settings.name.trim().length === 0} onClick={download}>
            {exporting ? "Packing the .mcworld…" : "Download .mcworld"}
          </Button>
          {saved ? <p className="text-sm text-[#234e45]">Saved {saved}. Import it before you all log in.</p> : null}
          {error ? (
            <p className="rounded-lg bg-[#f8e4dc] px-3 py-2 text-sm text-[#8a2e1b]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <details className="rounded-xl border border-[#e4d8c4] bg-[#fffaf3] px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">How to open it with the group</summary>
          <div className="mt-2 space-y-2 leading-relaxed text-[#4d473f]">
            <p>This is a Minecraft Bedrock world. Java Edition cannot open a .mcworld file.</p>
            <p>On Windows, double-click the file and Minecraft adds it to your worlds. On a phone or tablet, open the file and choose Minecraft.</p>
            <p>
              The person who imported it hosts. Everyone else joins from the Friends tab. The world is set to Friends
              only and visible on LAN; change that in the world settings if you want a wider circle.
            </p>
            <p>The sign at the meeting spot carries the world name. Coordinates in the corner match the ones in game.</p>
          </div>
        </details>
      </aside>
    </div>
  );
}
