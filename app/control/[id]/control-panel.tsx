"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { RoseCallButton } from "./rose-call-button";
import { PhoneCallButton } from "./phone-call-button";

export function ControlPanel({
  stayId,
  currentScene,
  totalScenes,
  sceneTitles,
  agentId,
  phoneAvailable,
  guestName,
  guestPhone,
  aiReady,
}: {
  stayId: number;
  currentScene: number;
  totalScenes: number;
  sceneTitles: string[];
  agentId: string | null;
  phoneAvailable: boolean;
  guestName: string;
  guestPhone: string;
  aiReady: boolean;
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
    <section className="mt-12">
      {/* Status pills */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusPill ok={aiReady} on="Claude live" off="Claude using fallback content" />
        <StatusPill
          ok={Boolean(agentId)}
          on="Rose voice agent connected"
          off="Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID for live voice"
        />
        <StatusPill
          ok={phoneAvailable}
          on="Real phone calls enabled"
          off="Add Twilio number to enable real phone calls"
        />
      </div>

      {/* Scene controller */}
      <div className="rw-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line bg-cream/40 px-5 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Scene {currentScene} / {totalScenes - 1}
            </p>
            <p className="font-serif mt-1 text-[15px] italic text-forest">
              {sceneTitles[currentScene]}
            </p>
          </div>
          <SceneDots
            total={totalScenes}
            current={currentScene}
            onJump={jumpTo}
            disabled={pending}
          />
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <button
            onClick={() => run("reset")}
            disabled={pending}
            className="rounded-sm border border-line bg-paper px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink"
          >
            Reset
          </button>
          <button
            onClick={() => run("advance")}
            disabled={pending || atEnd}
            className="flex-1 rounded-sm bg-forest px-6 py-3 text-[12px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep"
          >
            {atEnd ? "End of demo" : pending ? "Running…" : "Advance →"}
          </button>
        </div>

        {/* Per-scene helper text */}
        <div className="border-t border-line bg-paper px-5 py-3 text-[12px] leading-5 text-ink-muted">
          {sceneHint(currentScene)}
        </div>
      </div>

      {/* Live actions panel */}
      <div className="mt-8">
        <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
          Live actions
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-muted">
          These are real interactions — they bypass the scene sequence and
          drive the experience directly.
        </p>

        <div className="mt-4 space-y-3">
          <PhoneCallButton
            stayId={stayId}
            defaultNumber={guestPhone}
            available={phoneAvailable}
            onCallComplete={() => router.refresh()}
          />
          <RoseCallButton
            stayId={stayId}
            agentId={agentId}
            guestName={guestName}
            guestPhone={guestPhone}
            onCallComplete={() => router.refresh()}
          />
        </div>
      </div>
    </section>
  );
}

function StatusPill({
  ok,
  on,
  off,
}: {
  ok: boolean;
  on: string;
  off: string;
}) {
  return (
    <span
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10.5px] uppercase tracking-[0.2em] ${
        ok
          ? "border-emerald/30 bg-emerald/5 text-emerald"
          : "border-amber/30 bg-amber/5 text-amber"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald" : "bg-amber"}`}
      />
      {ok ? on : off}
    </span>
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
    <div className="flex items-center gap-1">
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

function sceneHint(scene: number): string {
  const hints: Record<number, string> = {
    0: "Click Advance to bring in Maya's email reply — Rose extracts the intake and shows the identity merge across her past Rosewood stays.",
    1: "Email + identity merge are live on the concierge screen.",
    2: "Whoop signal connected. Consent strip visible with auto-disconnect timestamp.",
    3: "Pre-arrival call transcript shown. Try the 'Place a live pre-arrival call' action below to do this in real time.",
    4: "Arrival brief just generated. Take your time — this is the wow card.",
    5: "Day-2 morning. The daily rhythm card is in pending state — point to the Approve button on the concierge screen.",
    6: "Approved. Soft SMS just landed on Maya's phone. Switch attention to the guest screen.",
    7: "Delight moment proposed. Note that the AI does not act without staff approval.",
    8: "Post-stay call played, durable memory written.",
    9: "Cross-property handoff — open the Hong Kong link to show the same rhythm with a different sense of place.",
  };
  return hints[scene] ?? "";
}
