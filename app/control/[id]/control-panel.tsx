"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { NewGuestButton } from "./new-guest-button";
import { PhoneCallButton } from "./phone-call-button";

/**
 * Step-by-step demo flow.
 *
 * Each named step represents one beat of the live demo. Steps light up in
 * order — the next one unlocks as the prior completes. The scene engine still
 * runs underneath, but the presenter drives via named buttons instead of
 * "Advance scene N".
 *
 * Pre-trip flow (1-3) is now the primary surface. The full scene controller
 * is kept below for in-stay / post-stay beats and rehearsal jumping.
 */

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
  steps,
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
  steps: {
    hasIdentity: boolean;
    hasIntake: boolean;
    hasCall: boolean;
    hasBrief: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // When the presenter switches back from the guest form tab, re-fetch state
  // so the step indicator flips from available → done.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  function resolveIdentity() {
    startTransition(async () => {
      await fetch("/api/identity/resolve", {
        method: "POST",
        body: JSON.stringify({ stayId }),
      });
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action: "reset" }),
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

  function advance() {
    startTransition(async () => {
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action: "advance" }),
      });
      router.refresh();
    });
  }

  function openGuestForm() {
    window.open(`/user/stays/${stayId}`, "_blank", "noopener,noreferrer");
  }

  function fillFormLive() {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`rose-form-${stayId}`);
    channel.postMessage({ type: "fill" });
    channel.close();
  }

  return (
    <section className="mt-12">
      {/* Status pills + new-guest action */}
      <div className="relative mb-6 flex flex-wrap items-center gap-2">
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
        <div className="ml-auto">
          <NewGuestButton />
        </div>
      </div>

      {/* PRE-TRIP FLOW — the primary demo surface */}
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[1.75rem] leading-tight text-forest">
            Pre-trip
          </h2>
          <span className="text-[10px] uppercase tracking-[0.32em] text-ink-muted">
            three steps · in order
          </span>
        </div>
        <p className="font-serif mt-2 text-[14px] italic text-ink-muted">
          Each step lands content in the staff thread on the admin screen. The
          arrival brief writes itself after the email and refines after the call.
        </p>

        <div className="mt-6 space-y-4">
          {/* Step 1 — Recognize the guest */}
          <DemoStep
            number={1}
            title="Recognize the guest"
            description={`Before we reach out: pull ${guestName.split(" ")[0]}'s profile from every other Rosewood property. Show what we already know — scent, pacing, occasions, prior stays — so the rest of the choreography starts from memory, not a blank slate.`}
            status={steps.hasIdentity ? "done" : "available"}
            doneNote="Profile unified · facts carried forward visible in the staff thread"
            action={
              <button
                onClick={resolveIdentity}
                disabled={pending}
                className="group flex items-center gap-2 rounded-sm bg-forest px-5 py-2.5 text-[11px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep disabled:opacity-50"
              >
                {pending ? "Resolving…" : "Pull cross-property profile"}
                <ExternalArrow />
              </button>
            }
          />

          {/* Step 2 — Send pre-arrival email */}
          <DemoStep
            number={2}
            title="Send pre-arrival email"
            description="With the guest's form already open in another window, click below — the fields fill themselves in real time, the guest submits, and her intake lands in the staff thread."
            status={
              !steps.hasIdentity
                ? "locked"
                : steps.hasIntake
                  ? "done"
                  : "available"
            }
            lockedNote="Recognize the guest first."
            doneNote="Form submitted · intake card visible in the staff thread"
            action={
              <div className="flex flex-col items-start gap-2">
                <button
                  onClick={fillFormLive}
                  className="group flex items-center gap-2 rounded-sm bg-forest px-5 py-2.5 text-[11px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep"
                >
                  Fill form live
                  <ExternalArrow />
                </button>
                <button
                  onClick={openGuestForm}
                  className="text-[10.5px] uppercase tracking-[0.22em] text-ink-muted underline-offset-4 hover:text-ink"
                >
                  Or open the guest view ↗
                </button>
              </div>
            }
          />

          {/* Step 3 — Call the day before (auto-refreshes the brief) */}
          <DemoStep
            number={3}
            title="Call the day before"
            description="Rose dials a real phone via Twilio — already knowing everything from the form plus carried-forward facts. Transcript and audio stream live to this card. The arrival brief in the staff thread refines itself the moment the call ends."
            status={
              !steps.hasIntake
                ? "locked"
                : steps.hasCall
                  ? "done"
                  : "available"
            }
            lockedNote="Complete the email step first."
            doneNote="Call recorded · brief updated in the staff thread"
            action={
              <PhoneCallButton
                stayId={stayId}
                defaultNumber={guestPhone}
                available={phoneAvailable}
                onCallComplete={() => router.refresh()}
              />
            }
            actionFullWidth
          />
        </div>
      </div>

      {/* In-stay + post-stay — keep available via scene controller */}
      <div className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[1.75rem] leading-tight text-forest">
            In-stay & post-stay
          </h2>
          <span className="text-[10px] uppercase tracking-[0.32em] text-ink-muted">
            via scene advance
          </span>
        </div>
        <p className="font-serif mt-2 text-[14px] italic text-ink-muted">
          Day-2 rhythm, approval gates, delight moments, post-stay call,
          cross-property handoff. One click per beat.
        </p>

        <div className="rw-card mt-6 overflow-hidden">
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
              onClick={reset}
              disabled={pending}
              className="rounded-sm border border-line bg-paper px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink"
            >
              Reset demo
            </button>
            <button
              onClick={advance}
              disabled={pending || currentScene >= totalScenes - 1}
              className="flex-1 rounded-sm bg-forest px-6 py-2.5 text-[11px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep disabled:opacity-40"
            >
              {currentScene >= totalScenes - 1
                ? "End of demo"
                : pending
                  ? "Running…"
                  : "Advance →"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step UI
// ---------------------------------------------------------------------------

function DemoStep({
  number,
  title,
  description,
  status,
  doneNote,
  lockedNote,
  action,
  actionFullWidth,
}: {
  number: number;
  title: string;
  description: string;
  status: "locked" | "available" | "done";
  doneNote?: string;
  lockedNote?: string;
  action: React.ReactNode;
  actionFullWidth?: boolean;
}) {
  return (
    <div
      className={`rw-card overflow-hidden transition-opacity ${
        status === "locked" ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-start gap-4 px-5 py-5">
        <StepBadge number={number} status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="font-serif text-[1.125rem] leading-snug text-forest">
              {title}
            </h3>
            <StatusTag status={status} />
          </div>
          <p className="mt-2 text-[13px] leading-6 text-ink-soft">
            {description}
          </p>

          {status === "done" && doneNote && (
            <p className="mt-3 text-[11.5px] uppercase tracking-[0.18em] text-emerald">
              ✓ {doneNote}
            </p>
          )}

          {status === "locked" && lockedNote && (
            <p className="mt-3 text-[11.5px] italic text-ink-muted">
              {lockedNote}
            </p>
          )}

          {status !== "locked" && !actionFullWidth && (
            <div className="mt-4">{action}</div>
          )}
        </div>
      </div>

      {status !== "locked" && actionFullWidth && (
        <div className="border-t border-line bg-paper/60 px-5 py-4">
          {action}
        </div>
      )}
    </div>
  );
}

function StepBadge({
  number,
  status,
}: {
  number: number;
  status: "locked" | "available" | "done";
}) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
        status === "done"
          ? "border-emerald bg-emerald text-paper"
          : status === "available"
            ? "border-forest bg-forest text-cream"
            : "border-line bg-cream text-ink-muted"
      }`}
    >
      {status === "done" ? (
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <path
            d="M1 5l3.5 3.5L11 1.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="text-[12px] font-medium">{number}</span>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: "locked" | "available" | "done" }) {
  if (status === "done") {
    return (
      <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.22em] text-emerald">
        Complete
      </span>
    );
  }
  if (status === "available") {
    return (
      <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.22em] text-gold">
        Next
      </span>
    );
  }
  return (
    <span className="rounded-full bg-cream px-2 py-0.5 text-[9.5px] uppercase tracking-[0.22em] text-ink-muted">
      Locked
    </span>
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

function ExternalArrow() {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 14 10"
      fill="none"
      className="transition-transform group-hover:translate-x-0.5"
    >
      <path
        d="M1 5h11m0 0L8 1m4 4l-4 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
