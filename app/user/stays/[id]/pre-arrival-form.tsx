"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TalkToRose } from "./talk-to-rose";

/**
 * Pre-arrival intake — the guest's actual form. Two paths:
 *   • Connect a signal (Whoop = real OAuth, others = coming soon)
 *   • Tell Rose directly in a short form
 *
 * Either way, the form fields below are saved as intake. Submitting bumps
 * the demo scene forward so the staff thread updates.
 */

const VIBES: Array<{ value: string; label: string; hint: string }> = [
  { value: "restorative", label: "Restorative", hint: "I need to feel human again." },
  { value: "exploratory", label: "Exploratory", hint: "I want to wander the area." },
  { value: "productive", label: "Productive", hint: "I have work to do." },
  { value: "celebratory", label: "Celebratory", hint: "We're marking something." },
  { value: "social", label: "Social", hint: "We're hosting / out late." },
];

const EXPERIENCES = [
  "Asaya spa / recovery",
  "Wine tasting",
  "Garden walk / hike",
  "Private dining",
  "Yoga or movement",
  "Local cultural tour",
  "Bespoke — tell us below",
];

const COMFORT_OPTIONS = [
  { value: "warmer_room", label: "Warmer room" },
  { value: "softer_pacing", label: "Softer pacing" },
  { value: "quiet_first_night", label: "Quiet first night" },
  { value: "late_breakfast", label: "Late breakfast" },
  { value: "no_morning_calls", label: "No morning calls or knocks" },
  {
    value: "cycle_comfort",
    label: "Cycle-aware comfort",
    note: "Translated only to: warmer room, gentler pacing. Never shown as data.",
  },
];

export function PreArrivalForm({
  stayId,
  guestName,
  guestPhone,
  propertyName,
  agentId,
  alreadySubmitted,
  initialConnectedSource = null,
}: {
  stayId: number;
  guestName: string;
  guestPhone: string;
  propertyName: string;
  agentId: string | null;
  alreadySubmitted: boolean;
  initialConnectedSource?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [connectedSource, setConnectedSource] = useState<string | null>(
    initialConnectedSource,
  );
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [talkOpen, setTalkOpen] = useState(false);

  // Form state
  const [flight, setFlight] = useState("");
  const [vibe, setVibe] = useState("restorative");
  const [comfort, setComfort] = useState<string[]>([
    "quiet_first_night",
    "softer_pacing",
  ]);
  const [experiences, setExperiences] = useState<string[]>([]);
  const [scent, setScent] = useState("");
  const [contactPreference, setContactPreference] = useState<"sms" | "voice" | "either">("sms");
  const [companion, setCompanion] = useState("");
  const [anythingElse, setAnythingElse] = useState("");

  function toggleComfort(v: string) {
    setComfort((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  }
  function toggleExperience(v: string) {
    setExperiences((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  }

  // -------------------------------------------------------------------------
  // Live auto-fill — driven by the control panel. Two delivery paths:
  //   a) BroadcastChannel for any tab already mounted (instant, no I/O)
  //   b) localStorage signal for tabs that mount AFTER the click, or that
  //      are refreshing because the demo was just reset
  //
  // Three corner cases this handles:
  //   • Demo was reset on /control while this tab was open → server-side
  //     intake row is gone but local React state still has submitted=true.
  //     We sync `submitted` to the prop below so a router.refresh() in this
  //     tab snaps the form back to the "ready to fill" state.
  //   • Click-then-open: presenter clicks "Fill form live" before the
  //     guest tab is open. The localStorage signal sits there with a 60s
  //     freshness window; the form picks it up the moment it mounts.
  //   • Click-while-submitted: the listener calls router.refresh() so the
  //     server reads the latest intake row and re-prop'd `alreadySubmitted`
  //     can flip to false; the still-fresh localStorage signal then fires
  //     on the next mount.
  // -------------------------------------------------------------------------

  const fillingRef = useRef(false);

  // Keep local "submitted" in sync with the server-side prop so a reset on
  // the control panel (which deletes intake rows) actually un-locks the form.
  useEffect(() => {
    setSubmitted(alreadySubmitted);
  }, [alreadySubmitted]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `rose-form-${stayId}`;

    const consume = (raw: string | null) => {
      if (!raw) return;
      let sig: { type?: string; at?: number; payload?: FillPayload };
      try {
        sig = JSON.parse(raw);
      } catch {
        return;
      }
      if (sig.type !== "fill" || typeof sig.at !== "number") return;
      // 60s freshness window — drop stale signals from earlier sessions.
      if (Date.now() - sig.at > 60_000) {
        try {
          localStorage.removeItem(key);
        } catch {}
        return;
      }
      if (fillingRef.current) return;

      // If the form is showing the "Received with thanks" state, the server
      // may already disagree (post-reset). Refresh so the latest server data
      // re-renders us; we deliberately leave the signal in localStorage so
      // the next mount picks it up.
      if (submitted) {
        router.refresh();
        return;
      }

      fillingRef.current = true;
      try {
        localStorage.removeItem(key);
      } catch {}
      autoFill(sig.payload ?? defaultFill).finally(() => {
        fillingRef.current = false;
      });
    };

    // 1) Pick up any signal that was waiting for us when we mounted.
    try {
      consume(localStorage.getItem(key));
    } catch {}

    // 2) Listen for signals stored by other tabs on this origin.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      consume(e.newValue);
    };
    window.addEventListener("storage", onStorage);

    // 3) Instant in-session delivery for already-open tabs.
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(key);
      channel.onmessage = (ev) => consume(JSON.stringify(ev.data));
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [stayId, submitted, router]);

  async function autoFill(p: FillPayload) {
    // Scroll user to top so they see the form as it fills.
    window.scrollTo({ top: 0, behavior: "smooth" });
    await wait(400);

    await typeInto(setFlight, p.flight);
    await wait(280);

    setVibe(p.vibe);
    await wait(280);

    // Reset and re-add comfort flags one at a time so audience watches them light up.
    setComfort([]);
    await wait(160);
    for (const flag of p.comfort) {
      setComfort((prev) => [...prev, flag]);
      await wait(180);
    }
    await wait(180);

    setExperiences([]);
    await wait(160);
    for (const exp of p.experiences) {
      setExperiences((prev) => [...prev, exp]);
      await wait(180);
    }
    await wait(220);

    await typeInto(setScent, p.scent);
    await wait(240);

    setContactPreference(p.contactPreference);
    await wait(280);

    await typeInto(setCompanion, p.companion);
    await wait(240);

    await typeInto(setAnythingElse, p.anythingElse);
    // No auto-submit — the presenter clicks "Send to Rose" themselves so
    // the timing of the magic moment is theirs.
  }

  function connectWhoop() {
    // Real OAuth flow — carries stayId so the callback advances this stay.
    window.location.href = `/auth/whoop/start?stayId=${stayId}`;
  }

  function submitForm() {
    startTransition(async () => {
      // Convert form into a fluent transcript so the same interpretIntake
      // pipeline runs over it — keeping a single source of truth.
      const transcript = composeTranscript({
        guestName,
        flight,
        vibe,
        comfort,
        experiences,
        scent,
        contactPreference,
        companion,
        anythingElse,
      });

      await fetch("/api/intake/from-call", {
        method: "POST",
        body: JSON.stringify({
          stayId,
          transcript,
          source: "in_app_chat",
        }),
      });

      // If Whoop was connected, advance to consent scene; else go to scene 1 (intake landed).
      const targetScene = connectedSource === "whoop" ? 2 : 1;
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action: "jump", target: targetScene }),
      });

      setSubmitted(true);
      router.refresh();
    });
  }

  if (submitted) {
    return (
      <section className="rw-enter mt-14 rounded-sm border border-line bg-paper p-8">
        <div className="flex items-start gap-4">
          <span className="rw-pulse mt-2 inline-block h-2 w-2 rounded-full bg-emerald text-emerald" />
          <div>
            <p className="text-[0.625rem] uppercase tracking-[0.32em] text-emerald">
              Received with thanks
            </p>
            <h2 className="font-serif mt-3 text-2xl leading-snug text-forest">
              We have your rhythm, {guestName.split(" ")[0]}.
            </h2>
            <p className="mt-3 text-[14px] leading-6 text-ink-soft">
              {propertyName} will translate this into the pacing of your stay
              — never the data itself. Rose will text the evening before to
              confirm the final details.
            </p>
            <p className="mt-4 text-[12px] text-ink-muted">
              Auto-disconnects at checkout. You can stop at any time.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-14 space-y-12">
      {/* Step 1: Connect health */}
      <section>
        <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
          Share a signal (optional)
        </p>
        <p className="mt-2 text-[14px] leading-6 text-ink-soft">
          Connect a device so Rose can shape pacing around how you&rsquo;re
          actually travelling. Auto-disconnects at checkout. Or just talk to
          us instead — the form below is enough.
        </p>

        <div className="rw-stagger mt-5 space-y-2.5">
          <SourceCard
            label="Whoop"
            tagline={
              connectedSource === "whoop"
                ? "Connected · auto-disconnect at checkout"
                : "Connect your account — recovery, sleep, strain"
            }
            available
            primary
            connected={connectedSource === "whoop"}
            onClick={connectWhoop}
          />
          <SourceCard label="Apple Health" tagline="Coming soon" />
          <SourceCard label="Oura" tagline="Coming soon" />
          <SourceCard label="Garmin" tagline="Coming soon" />

          <SourceCard
            label={
              talkOpen ? "Tap a question above or end the chat" : "Talk to Rose instead"
            }
            tagline={
              talkOpen
                ? "Rose is asking via voice. Form below stays as a fallback."
                : "A short voice exchange — no device required"
            }
            available
            conversational
            connected={talkOpen}
            onClick={() => setTalkOpen((v) => !v)}
          />
        </div>

        {talkOpen && (
          <div className="rw-enter mt-3">
            <TalkToRose
              stayId={stayId}
              agentId={agentId}
              guestName={guestName}
              guestPhone={guestPhone}
              onCallComplete={() => {
                setSubmitted(true);
                router.refresh();
              }}
            />
          </div>
        )}
      </section>

      {/* Step 2: Manual fields */}
      <section>
        <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
          Or just tell us
        </p>
        <p className="mt-2 text-[14px] leading-6 text-ink-soft">
          A few short questions — none of them required, but each one lets us
          choreograph your arrival better.
        </p>

        <div className="rw-stagger mt-8 space-y-10">
          {/* Flight */}
          <FormBlock label="Your flight">
            <input
              value={flight}
              onChange={(e) => setFlight(e.target.value)}
              placeholder="e.g., AA 8 — JFK to SFO, Thu morning"
              className="w-full border-b border-line bg-transparent py-2 text-[16px] leading-7 text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
            />
            <p className="mt-2 text-[11.5px] italic text-ink-muted">
              We&rsquo;ll match this to your check-in window and prepare your
              room temperature for the time you land — not the time you booked.
            </p>
          </FormBlock>

          {/* Vibe */}
          <FormBlock label="How are you arriving?">
            <div className="space-y-2">
              {VIBES.map((v) => (
                <label
                  key={v.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-sm border px-4 py-3 ${
                    vibe === v.value
                      ? "border-gold bg-paper"
                      : "border-line bg-paper/60 hover:border-ink-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="vibe"
                    value={v.value}
                    checked={vibe === v.value}
                    onChange={() => setVibe(v.value)}
                    className="sr-only"
                  />
                  <span
                    className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      vibe === v.value ? "bg-gold" : "bg-line"
                    }`}
                  />
                  <div>
                    <p className="text-[14px] text-forest">{v.label}</p>
                    <p className="text-[12.5px] italic text-ink-muted">
                      &ldquo;{v.hint}&rdquo;
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </FormBlock>

          {/* Comfort */}
          <FormBlock label="Comfort">
            <div className="flex flex-wrap gap-2">
              {COMFORT_OPTIONS.map((o) => {
                const on = comfort.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggleComfort(o.value)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] tracking-wide ${
                      on
                        ? "border-gold bg-gold/10 text-forest"
                        : "border-line bg-paper text-ink-soft hover:border-ink-muted"
                    }`}
                    title={o.note}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {comfort.includes("cycle_comfort") && (
              <p className="rw-enter mt-3 text-[11.5px] italic text-ink-muted">
                Surfaced only as &ldquo;warmer room, gentler pacing.&rdquo;
                Staff never see the underlying data.
              </p>
            )}
          </FormBlock>

          {/* Experiences */}
          <FormBlock label="Experiences you&rsquo;re interested in">
            <div className="flex flex-wrap gap-2">
              {EXPERIENCES.map((e) => {
                const on = experiences.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleExperience(e)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] ${
                      on
                        ? "border-gold bg-gold/10 text-forest"
                        : "border-line bg-paper text-ink-soft hover:border-ink-muted"
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </FormBlock>

          {/* Companion */}
          <FormBlock label="Travelling with anyone?">
            <input
              value={companion}
              onChange={(e) => setCompanion(e.target.value)}
              placeholder="e.g., Alex (partner) — joining Saturday for our anniversary"
              className="w-full border-b border-line bg-transparent py-2 text-[16px] leading-7 text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
            />
            <p className="mt-2 text-[11.5px] italic text-ink-muted">
              We&rsquo;ll prep with both of you in mind — pacing, dining, any
              occasion you&rsquo;re marking.
            </p>
          </FormBlock>

          {/* Scent */}
          <FormBlock label="A scent that has worked before (optional)">
            <input
              value={scent}
              onChange={(e) => setScent(e.target.value)}
              placeholder="e.g., the lavender at Crillon"
              className="w-full border-b border-line bg-transparent py-2 text-[16px] leading-7 text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
            />
          </FormBlock>

          {/* Contact preference */}
          <FormBlock label="How should we reach you?">
            <div className="flex gap-2">
              {(["sms", "voice", "either"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setContactPreference(c)}
                  className={`rounded-full border px-4 py-1.5 text-[12px] capitalize ${
                    contactPreference === c
                      ? "border-gold bg-gold/10 text-forest"
                      : "border-line bg-paper text-ink-soft hover:border-ink-muted"
                  }`}
                >
                  {c === "sms" ? "Text" : c === "voice" ? "Voice call" : "Either"}
                </button>
              ))}
            </div>
          </FormBlock>

          {/* Anything else */}
          <FormBlock label="Anything else">
            <textarea
              value={anythingElse}
              onChange={(e) => setAnythingElse(e.target.value)}
              rows={3}
              placeholder="A board dinner Friday, a partner's birthday Saturday, a quiet morning request — anything."
              className="w-full resize-none border-b border-line bg-transparent py-2 text-[15px] leading-7 text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
            />
          </FormBlock>

          <div className="pt-2">
            <button
              onClick={submitForm}
              disabled={pending}
              className="group flex items-center gap-3 rounded-sm bg-forest px-6 py-3.5 text-[12px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep"
            >
              <span>{pending ? "Sending…" : "Send to Rose"}</span>
              <svg
                width="22"
                height="14"
                viewBox="0 0 22 14"
                fill="none"
                className="transition-transform group-hover:translate-x-1"
              >
                <path
                  d="M1 7h19m0 0L14 1m6 6l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* Promise */}
      <section className="rounded-sm border border-line bg-paper/60 p-6 sm:p-8">
        <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
          Our promise
        </p>
        <ul className="mt-4 space-y-3 text-[14px] leading-6 text-ink-soft">
          <li className="flex gap-3">
            <Dot /> We never show staff your raw data. Only thoughtful pacing.
          </li>
          <li className="flex gap-3">
            <Dot /> We auto-disconnect at checkout.
          </li>
          <li className="flex gap-3">
            <Dot /> You can disconnect at any moment with a single tap.
          </li>
          <li className="flex gap-3">
            <Dot /> We will never write to your device or change your data.
          </li>
        </ul>
      </section>
    </div>
  );
}

function FormBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-serif text-[16px] leading-snug text-forest">
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SourceCard({
  label,
  tagline,
  available,
  primary,
  conversational,
  connected,
  onClick,
}: {
  label: string;
  tagline: string;
  available?: boolean;
  primary?: boolean;
  conversational?: boolean;
  connected?: boolean;
  onClick?: () => void;
}) {
  const base =
    "group flex w-full items-center rounded-sm border px-5 py-5 text-left transition-all";
  let cls: string;
  if (connected) {
    cls = `${base} border-emerald/30 bg-emerald/5`;
  } else if (primary) {
    cls = `${base} border-line bg-paper hover:border-gold hover:shadow-md cursor-pointer`;
  } else if (conversational) {
    cls = `${base} border-line bg-cream hover:border-gold cursor-pointer`;
  } else {
    cls = `${base} border-line-soft bg-paper/50 opacity-60 cursor-not-allowed`;
  }

  return (
    <button onClick={onClick} disabled={!available && !connected} className={cls}>
      <div className="flex flex-1 items-center justify-between gap-6">
        <div className="text-left">
          <div className="flex items-center gap-3">
            <span
              className={
                conversational
                  ? "font-serif text-xl text-forest"
                  : "text-base font-medium text-forest"
              }
            >
              {label}
            </span>
            {connected && (
              <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald">
                Connected
              </span>
            )}
            {primary && !connected && (
              <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald">
                Available
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">{tagline}</p>
        </div>
        {available && !connected && (
          <svg
            width="20"
            height="14"
            viewBox="0 0 20 14"
            fill="none"
            className="text-gold transition-transform group-hover:translate-x-1"
          >
            <path
              d="M1 7h17m0 0L12 1m6 6l-6 6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
    </button>
  );
}

function Dot() {
  return (
    <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-gold" />
  );
}

function composeTranscript(input: {
  guestName: string;
  flight: string;
  vibe: string;
  comfort: string[];
  experiences: string[];
  scent: string;
  contactPreference: string;
  companion: string;
  anythingElse: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Rose: Thanks for filling this in, ${input.guestName.split(" ")[0]} — let me capture the high points.`,
  );
  if (input.flight) lines.push(`${input.guestName}: My flight is ${input.flight}.`);
  if (input.vibe) lines.push(`${input.guestName}: I'm arriving in a ${input.vibe} state of mind.`);
  if (input.companion.trim()) {
    lines.push(`${input.guestName}: I'm travelling with ${input.companion.trim()}.`);
  }
  if (input.comfort.length > 0) {
    lines.push(
      `${input.guestName}: For comfort — ${input.comfort.join(", ").replace(/_/g, " ")}.`,
    );
  }
  if (input.experiences.length > 0) {
    lines.push(
      `${input.guestName}: Experiences I'd love during the stay: ${input.experiences.join(", ")}.`,
    );
  }
  if (input.scent) lines.push(`${input.guestName}: For scent — ${input.scent}.`);
  lines.push(`${input.guestName}: I prefer ${input.contactPreference === "sms" ? "text" : input.contactPreference} as a way to reach me.`);
  if (input.anythingElse.trim()) lines.push(`${input.guestName}: ${input.anythingElse.trim()}`);
  lines.push(`Rose: Got it — we'll have it ready.`);
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Live auto-fill helpers
// ---------------------------------------------------------------------------

export interface FillPayload {
  flight: string;
  vibe: string;
  comfort: string[];
  experiences: string[];
  scent: string;
  contactPreference: "sms" | "voice" | "either";
  companion: string;
  anythingElse: string;
}

const defaultFill: FillPayload = {
  flight: "AA 8 — JFK to SFO, lands Thu 7:42am",
  vibe: "restorative",
  comfort: [
    "quiet_first_night",
    "softer_pacing",
    "late_breakfast",
    "cycle_comfort",
  ],
  experiences: ["Asaya spa / recovery", "Garden walk / hike", "Wine tasting"],
  scent: "lavender, like the Hotel de Crillon room",
  contactPreference: "sms",
  companion: "Alex (partner) — joining Saturday for our anniversary",
  anythingElse:
    "Board dinner Friday — please nothing intense before then. Move the wine tasting to Saturday so Alex can join.",
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function typeInto(
  setter: (value: string) => void,
  text: string,
  msPerChar = 28,
): Promise<void> {
  return new Promise((resolve) => {
    if (!text) {
      setter("");
      resolve();
      return;
    }
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setter(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        resolve();
      }
    }, msPerChar);
  });
}
