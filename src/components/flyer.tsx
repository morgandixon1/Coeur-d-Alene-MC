"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlyView, type Spot } from "@/components/fly-view";
import { MapView } from "@/components/map-view";

type WorldChoice = { id: string; label: string };
type Mode = "3d" | "2d";

export function Flyer() {
  const [worlds, setWorlds] = useState<WorldChoice[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [spawn, setSpawn] = useState<{ world: string; spot: Spot } | null>(null);
  const [mode, setMode] = useState<Mode>("3d");
  const [message, setMessage] = useState("Pick a world.");
  const where = useRef<Spot>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    void fetch("/api/fly/worlds")
      .then((response) => response.json())
      .then((body: { worlds: WorldChoice[] }) => setWorlds(body.worlds))
      .catch(() => setMessage("Could not list the .mcworld files."));
  }, []);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void fetch(`/api/fly/spawn?world=${encodeURIComponent(active)}`)
      .then((response) => response.json())
      .then((body: { spawn?: Spot; error?: string }) => {
        if (stopped) return;
        if (!body.spawn) {
          setMessage(body.error ?? "Could not open that world.");
          return;
        }
        where.current = { x: body.spawn.x + 0.5, y: body.spawn.y + 40, z: body.spawn.z + 0.5 };
        setSpawn({ world: active, spot: body.spawn });
      })
      .catch(() => {
        if (!stopped) setMessage("Could not open that world.");
      });
    return () => {
      stopped = true;
    };
  }, [active]);

  const flyTo = useCallback((spot: Spot) => {
    where.current = spot;
    setMode("3d");
  }, []);

  const ready = spawn && spawn.world === active ? spawn : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#8ec6ea] text-[#1c1915]">
      {ready && mode === "3d" && <FlyView key={ready.world} world={ready.world} where={where} onMessage={setMessage} />}
      {ready && mode === "2d" && (
        <MapView key={ready.world} world={ready.world} spawn={ready.spot} where={where} onMessage={setMessage} onFly={flyTo} />
      )}
      <div className="pointer-events-none absolute top-3 left-3 max-w-sm rounded-2xl bg-[#fffaf3]/92 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Fly through</p>
          <div className="pointer-events-auto flex rounded-full bg-[#efe6d6] p-0.5 text-xs">
            {(["3d", "2d"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                className={`rounded-full px-2.5 py-0.5 ${mode === choice ? "bg-[#234e45] text-[#f6f1e7]" : ""}`}
                onClick={() => setMode(choice)}
              >
                {choice === "3d" ? "3D" : "2D map"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[#3f3a33]">{message}</p>
        <div className="pointer-events-auto mt-2 flex flex-wrap gap-2">
          {worlds.map((world) => (
            <button
              key={world.id}
              type="button"
              className={`rounded-full px-2.5 py-1 text-xs ${active === world.id ? "bg-[#234e45] text-[#f6f1e7]" : "bg-[#efe6d6]"}`}
              onClick={() => {
                if (world.id === active) return;
                setActive(world.id);
                setMessage(`Opening ${world.label}. The first chunks take a moment.`);
              }}
            >
              {world.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
