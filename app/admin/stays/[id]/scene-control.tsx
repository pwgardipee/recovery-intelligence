"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Compact scene controller, sits under the admin top bar. The demo presenter
 * keeps eyes on the threads — one button per beat.
 */
export function SceneControl({
  stayId,
  currentScene,
  totalScenes,
  currentTitle,
}: {
  stayId: number;
  currentScene: number;
  totalScenes: number;
  currentTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: "advance" | "reset") {
    startTransition(async () => {
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action }),
      });
      router.refresh();
    });
  }

  function jumpTo(target: number) {
    startTransition(async () => {
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action: "jump", target }),
      });
      router.refresh();
    });
  }

  const atEnd = currentScene >= totalScenes - 1;

  return (
    <div className="border-t border-line bg-cream/50">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Scene {currentScene} / {totalScenes - 1}
          </span>
          <span className="text-[12px] italic text-ink-soft">
            {currentTitle}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SceneDots
            total={totalScenes}
            current={currentScene}
            onJump={jumpTo}
            disabled={pending}
          />
          <button
            onClick={() => run("reset")}
            disabled={pending}
            className="rounded-sm border border-line bg-paper px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink"
          >
            Reset
          </button>
          <button
            onClick={() => run("advance")}
            disabled={pending || atEnd}
            className="rounded-sm bg-forest px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] text-cream hover:bg-forest-deep disabled:opacity-40"
          >
            {atEnd ? "End of demo" : pending ? "Running…" : "Advance →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SceneDots({
  total,
  current,
  onJump,
  disabled,
}: {
  total: number;
  current: number;
  onJump: (i: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="mr-3 flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onJump(i)}
          disabled={disabled}
          aria-label={`Jump to scene ${i}`}
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? "w-6 bg-forest"
              : i < current
                ? "w-1.5 bg-gold"
                : "w-1.5 bg-line"
          }`}
        />
      ))}
    </div>
  );
}
