"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { ArrivalBrief, DailyRhythm } from "@/lib/ai/prompts";

export interface RenderedMessage {
  id: number;
  thread: "staff" | "guest";
  author: string;
  authorRole: "ai" | "staff" | "guest";
  kind: string;
  content: Record<string, unknown>;
  approvalStatus: "auto" | "pending" | "approved" | "declined";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Staff thread
// ---------------------------------------------------------------------------

export function StaffThread({
  messages,
  newestFirst = false,
}: {
  messages: RenderedMessage[];
  /**
   * When true, reverse the message order (newest at the top) and skip the
   * auto-scroll-to-bottom — used on the History tab so the most recent
   * activity is immediately visible.
   */
  newestFirst?: boolean;
}) {
  // Skip auto-scroll when rendering newest-first, otherwise the view would
  // jump to the oldest message which is the opposite of what the operator
  // wants.
  const scrollRef = useAutoScroll(newestFirst ? 0 : messages.length);
  const ordered = newestFirst ? [...messages].reverse() : messages;
  return (
    <div className="flex h-full flex-col">
      <ThreadHeader
        title="Sand Hill · Concierge group"
        subtitle="Rose · Anya · Philip · Eun"
        liveDot
      />
      <div
        ref={scrollRef}
        className="rw-scroll flex-1 space-y-6 overflow-y-auto px-6 py-8"
      >
        {ordered.length === 0 ? (
          <EmptyHint
            line="Quiet for now. Advance the demo to bring the first beat in."
          />
        ) : (
          ordered.map((m, i) => (
            <StaffMessage key={m.id} message={m} index={i} />
          ))
        )}
      </div>
    </div>
  );
}

function StaffMessage({
  message,
  index,
}: {
  message: RenderedMessage;
  index: number;
}) {
  const isAI = message.authorRole === "ai";
  return (
    <div
      className="rw-enter flex items-start gap-3"
      style={{ animationDelay: `${Math.min(index, 7) * 140}ms` }}
    >
      <Avatar author={message.author} role={message.authorRole} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-forest">
            {authorDisplay(message.author)}
          </span>
          {isAI && (
            <span className="rounded-sm bg-gold/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em] text-gold">
              AI · concierge
            </span>
          )}
          <span className="text-[11px] text-ink-muted">just now</span>
        </div>
        <div className="mt-1.5">
          <MessageBody message={message} />
        </div>
      </div>
    </div>
  );
}

function MessageBody({ message }: { message: RenderedMessage }) {
  const c = message.content;
  switch (message.kind) {
    case "text":
      return (
        <p className="text-[14px] leading-6 text-ink-soft">
          {(c as { line: string }).line}
        </p>
      );

    case "consent_strip":
      return <ConsentStrip content={c as never} />;

    case "identity_merge":
      return <IdentityMerge content={c as never} />;

    case "intake_card":
      return <IntakeCard content={c as never} />;

    case "voice_call":
      return <VoiceCall content={c as never} />;

    case "arrival_brief":
      return <ArrivalBriefCard content={c as never} />;

    case "daily_rhythm":
      return (
        <DailyRhythmCard
          messageId={message.id}
          approvalStatus={message.approvalStatus}
          content={c as never}
        />
      );

    case "delight_moment":
      return (
        <DelightMoment
          messageId={message.id}
          approvalStatus={message.approvalStatus}
          content={c as never}
        />
      );

    case "memory_write":
      return <MemoryWrite content={c as never} />;

    case "preloaded_memory":
      return <PreloadedMemory content={c as never} />;

    case "system_event":
      return <SystemEvent content={c as never} />;

    default:
      return (
        <pre className="text-[11px] text-ink-muted">
          {JSON.stringify(c, null, 2)}
        </pre>
      );
  }
}

// ---------------------------------------------------------------------------
// Rich card components
// ---------------------------------------------------------------------------

function ConsentStrip({
  content,
}: {
  content: { source: string; connectedAt: string; autoDisconnectAt: string; use: string };
}) {
  const disconnect = new Date(content.autoDisconnectAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="rw-card flex items-center gap-4 px-4 py-3">
      <span className="text-emerald rw-pulse inline-block h-1.5 w-1.5 rounded-full" />
      <div className="flex-1 text-[12.5px] leading-5 text-ink-soft">
        <span className="font-medium text-forest">{content.source} connected.</span>{" "}
        Auto-disconnect {disconnect} · {content.use}
      </div>
    </div>
  );
}

function IdentityMerge({
  content,
}: {
  content: {
    headline: string;
    properties: string[];
    factsCarried?: Array<{
      fact: string;
      kind?: string;
      source?: string | null;
      confidence?: number;
    }>;
    summary?: string;
  };
}) {
  const facts = content.factsCarried ?? [];
  return (
    <div className="rw-card overflow-hidden">
      <div className="border-b border-line bg-forest px-5 py-4 text-cream">
        <p className="rw-monogram text-[10px] tracking-[0.32em] text-gold-soft">
          CROSS-PROPERTY · PROFILE RESOLUTION
        </p>
        <p className="font-serif mt-2 text-[15px] leading-snug text-paper">
          {content.headline}
        </p>
        {content.summary && (
          <p className="mt-2 text-[12.5px] italic text-cream/85">
            {content.summary}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-[180px_1fr]">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Properties unified
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-ink-soft">
            {content.properties.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Carried forward
          </p>
          {facts.length === 0 ? (
            <p className="mt-2 text-[12.5px] italic text-ink-muted">
              First Rosewood stay — no prior preferences on file.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {facts.map((f, i) => (
                <li
                  key={i}
                  className="rounded-sm border border-line bg-cream/40 px-3 py-2"
                >
                  <p className="font-serif text-[13px] leading-snug text-forest">
                    {f.fact}
                  </p>
                  {f.source && (
                    <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-ink-muted">
                      from {f.source}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function IntakeCard({
  content,
}: {
  content: {
    vibe: string;
    pacing: string;
    avoid: string[];
    foodPreferences: string[];
    contactPreference: string;
    scent: string | null;
    occasion: string | null;
    summary: string;
    propertyName: string;
    experiencesRequested?: string[];
    comfortFlags?: string[];
    flight?: {
      number?: string | null;
      origin?: string | null;
      destination?: string | null;
      arrivalTime?: string | null;
      notes?: string | null;
    } | null;
    companion?: {
      name?: string;
      relationship?: string;
      note?: string | null;
    } | null;
    sourceLabel?: string;
    originalText?: string;
  };
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const flight = content.flight;
  const hasFlight =
    flight && (flight.number || flight.arrivalTime || flight.origin);

  return (
    <div className="rw-card px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-gold">
          {content.sourceLabel ?? "Pre-arrival read"}
        </p>
        {content.originalText && (
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="text-[11px] text-ink-muted underline-offset-4 hover:text-ink"
          >
            {showOriginal ? "hide original" : "view original"}
          </button>
        )}
      </div>

      {showOriginal && content.originalText && (
        <pre className="rw-enter mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap border-l-2 border-line bg-cream/40 px-4 py-3 font-serif text-[13px] leading-6 text-ink-soft">
          {content.originalText}
        </pre>
      )}

      <p className="font-serif mt-3 text-[17px] leading-snug text-forest">
        {content.summary}
      </p>
      <div className="rw-rule mt-4" />

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {hasFlight && (
          <div className="rounded-sm border border-line bg-cream/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Flight
            </p>
            <p className="mt-1 font-serif text-[15px] text-forest">
              {flight?.number}
              {flight?.origin && flight?.destination
                ? ` · ${flight.origin} → ${flight.destination}`
                : ""}
            </p>
            {flight?.arrivalTime && (
              <p className="text-[12px] text-ink-soft">
                Lands {flight.arrivalTime}
                {flight.notes ? ` · ${flight.notes}` : ""}
              </p>
            )}
          </div>
        )}
        {content.companion && content.companion.name && (
          <div className="rounded-sm border border-line bg-cream/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Travelling with
            </p>
            <p className="mt-1 font-serif text-[15px] text-forest">
              {content.companion.name}
              {content.companion.relationship
                ? ` · ${content.companion.relationship}`
                : ""}
            </p>
            {content.companion.note && (
              <p className="text-[12px] italic text-ink-soft">
                {content.companion.note}
              </p>
            )}
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-[12.5px]">
        <Field label="Arrival" value={content.vibe} />
        <Field label="Pacing" value={content.pacing} />
        <Field label="Contact" value={content.contactPreference} />
        <Field label="Scent" value={content.scent ?? "—"} />
        <Field label="Occasion" value={content.occasion ?? "—"} className="col-span-2" />
      </dl>

      {content.experiencesRequested && content.experiencesRequested.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Experiences requested
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {content.experiencesRequested.map((e) => (
              <span key={e} className="rw-tag" style={{ background: "var(--rw-gold-soft)" }}>
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {content.foodPreferences.map((f) => (
          <span key={f} className="rw-tag">{f}</span>
        ))}
        {content.avoid.map((a) => (
          <span key={a} className="rw-tag" style={{ color: "var(--rw-clay)" }}>
            avoid: {a}
          </span>
        ))}
      </div>

      {content.comfortFlags && content.comfortFlags.includes("cycle_comfort") && (
        <p className="mt-4 border-l-2 border-rose pl-3 text-[11.5px] italic text-ink-muted">
          Comfort mode flagged. Surfaced only as warmer room and gentler
          pacing — no further detail visible to staff.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function VoiceCall({
  content,
}: {
  content: {
    direction: string;
    to: string;
    audioUrl: string;
    duration: string;
    label?: string;
    transcript: Array<{ who: string; line: string }>;
    summary: string;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rw-card px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-gold">
            {content.label ?? "Pre-arrival call"}
          </p>
          <p className="mt-1.5 text-[14px] text-forest">
            {content.direction === "outbound" ? "→" : "←"} {content.to} ·{" "}
            {content.duration}
          </p>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="text-[12px] text-ink-muted hover:text-ink"
        >
          {open ? "hide" : "show transcript"}
        </button>
      </div>
      <MinimalAudioPlayer src={content.audioUrl} />

      <p className="font-serif mt-3 text-[14px] leading-6 text-ink-soft">
        {content.summary}
      </p>
      {open && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3 text-[12.5px] leading-6">
          {content.transcript.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={`shrink-0 text-[10px] uppercase tracking-[0.2em] ${
                  t.who === "rose" ? "text-gold" : "text-ink-muted"
                }`}
                style={{ width: 64 }}
              >
                {t.who}
              </span>
              <span className="text-ink-soft">{t.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArrivalBriefCard({
  content,
}: {
  content: { brief: ArrivalBrief; propertyName: string; guestName: string };
}) {
  const b = content.brief;
  return (
    <article className="rw-card overflow-hidden">
      <header className="rw-stagger border-b border-line bg-forest px-6 py-5 text-cream">
        <div className="flex items-center justify-between">
          <p className="rw-monogram text-[10px] tracking-[0.32em] text-gold-soft">
            ROSEWOOD · {content.propertyName.toUpperCase()}
          </p>
          <span className="text-[10px] uppercase tracking-[0.22em] text-gold-soft">
            Arrival brief
          </span>
        </div>
        <h2 className="font-display mt-4 text-2xl leading-snug text-paper">
          {content.guestName}
        </h2>
        <p className="font-serif mt-2 text-[16px] leading-relaxed text-cream/90">
          {b.guestState}
        </p>
        <p className="mt-3 text-[12px] italic text-gold-soft">
          {b.senseOfPlaceLine}
        </p>
      </header>

      {b.flight && (b.flight.number || b.flight.arrivalTime) && (
        <div className="border-b border-line bg-cream/30 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-gold">
              Flight
            </span>
            <span className="font-serif text-[15px] text-forest">
              {b.flight.number}
              {b.flight.origin && b.flight.destination
                ? ` · ${b.flight.origin} → ${b.flight.destination}`
                : ""}
            </span>
            {b.flight.arrivalTime && (
              <span className="text-[12px] text-ink-soft">
                lands {b.flight.arrivalTime}
                {b.flight.notes ? ` · ${b.flight.notes}` : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {b.comfortLine && (
        <div className="border-b border-line bg-rose/10 px-6 py-3">
          <p className="text-[10px] uppercase tracking-[0.22em] text-clay">
            Comfort note
          </p>
          <p className="mt-1 font-serif text-[14px] leading-snug text-ink">
            {b.comfortLine}
          </p>
        </div>
      )}

      <div className="rw-stagger grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
        <Section title="Room prep">
          <p className="text-[13px] text-ink-soft">
            {b.roomPrep.temperatureF}°F · {b.roomPrep.lighting} ·{" "}
            <span className="italic">{b.roomPrep.scent}</span>
          </p>
          <ul className="mt-3 space-y-1.5">
            {b.roomPrep.amenities.map((a) => (
              <li
                key={a}
                className="flex gap-2 text-[12.5px] leading-5 text-ink"
              >
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-gold" />
                {a}
              </li>
            ))}
          </ul>
          {b.roomPrep.avoidInRoom.length > 0 && (
            <p className="mt-3 text-[11.5px] text-clay">
              avoid in room: {b.roomPrep.avoidInRoom.join(", ")}
            </p>
          )}
          <p className="mt-3 text-[11.5px] text-ink-muted">
            soundtrack: {b.roomPrep.soundtrack}
          </p>
        </Section>

        <Section title="First offer">
          <p className="font-serif text-[15px] leading-6 text-forest">
            &ldquo;{b.firstOffer.line}&rdquo;
          </p>
          {b.firstOffer.options.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-ink-muted">
              {b.firstOffer.options.map((o) => (
                <li key={o}>· {o}</li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-ink-muted">
            Service mode: {b.serviceMode.replace(/_/g, " ")}
          </p>
        </Section>

        <Section title="Do">
          <ul className="space-y-1.5">
            {b.staffDo.map((d) => (
              <li
                key={d}
                className="rw-do flex gap-2 pl-3 text-[12.5px] leading-5 text-ink"
              >
                {d}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Do not">
          <ul className="space-y-1.5">
            {b.staffDoNot.map((d) => (
              <li
                key={d}
                className="rw-donot flex gap-2 pl-3 text-[12.5px] leading-5 text-ink"
              >
                {d}
              </li>
            ))}
          </ul>
        </Section>

        {b.experiencesToPrep && b.experiencesToPrep.length > 0 && (
          <Section title="Experiences to prep" className="sm:col-span-2">
            <ul className="space-y-2">
              {b.experiencesToPrep.map((e) => (
                <li
                  key={e.experience + e.when}
                  className="rounded-sm border border-line bg-cream/30 px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-serif text-[14px] text-forest">
                      {e.experience}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                      {e.when}
                    </p>
                  </div>
                  <p className="mt-1 text-[12px] italic text-ink-soft">
                    {e.prepNote}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {b.delightMomentIdea && (
          <Section title="Optional delight" className="sm:col-span-2">
            <p className="font-serif text-[14px] italic text-clay">
              {b.delightMomentIdea}
            </p>
          </Section>
        )}
      </div>

      <footer className="border-t border-line bg-cream/40 px-6 py-3 text-[11px] text-ink-muted">
        Auto-applied: room temperature set to {b.roomPrep.temperatureF}°F ·
        Lavender scent staged · Wine tasting moved to Saturday
      </footer>
    </article>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="text-[10px] uppercase tracking-[0.22em] text-gold">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function DailyRhythmCard({
  messageId,
  approvalStatus,
  content,
}: {
  messageId: number;
  approvalStatus: "auto" | "pending" | "approved" | "declined";
  content: { rhythm: DailyRhythm; guestLine: string; dayLabel?: string };
}) {
  const r = content.rhythm;
  return (
    <div className="rw-card overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
          Today&rsquo;s rhythm · {content.dayLabel ?? "morning"}
        </p>
        <p className="font-serif mt-1 text-[14px] text-forest">
          {r.morningSubject === "softer"
            ? "Softer morning."
            : r.morningSubject === "fuller"
              ? "Open to a fuller day."
              : "Balanced day."}
        </p>
      </div>

      <ul className="rw-stagger divide-y divide-line-soft">
        {r.schedule.map((s) => (
          <li
            key={s.timeLabel + s.suggestion}
            className="flex items-baseline gap-4 px-5 py-2.5"
          >
            <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
              {s.timeLabel}
            </span>
            <span
              className={`text-[13px] leading-6 ${s.optional ? "text-ink-muted" : "text-ink"}`}
            >
              {s.suggestion}
              {s.optional && (
                <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  optional
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-line bg-cream/40 px-5 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
          Draft to guest
        </p>
        <p className="font-serif mt-1.5 text-[14px] leading-6 text-forest">
          &ldquo;{content.guestLine}&rdquo;
        </p>
      </div>

      <ApprovalBar messageId={messageId} status={approvalStatus} />

      {r.staffNote && (
        <div className="border-t border-line px-5 py-3 text-[12.5px] leading-6 text-ink-soft">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            staff note:&nbsp;
          </span>
          {r.staffNote}
        </div>
      )}
    </div>
  );
}

function DelightMoment({
  messageId,
  approvalStatus,
  content,
}: {
  messageId: number;
  approvalStatus: "auto" | "pending" | "approved" | "declined";
  content: {
    observation: string;
    proposal: string;
    cost: string;
    propertyHook: string;
  };
}) {
  return (
    <div className="rw-card overflow-hidden">
      <div className="border-l-2 border-clay px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-clay">
          Delight moment · proposal
        </p>
        <p className="mt-2 text-[12.5px] italic text-ink-muted">
          {content.observation}
        </p>
        <p className="font-serif mt-3 text-[16px] leading-snug text-forest">
          {content.proposal}
        </p>
        <p className="mt-3 text-[11.5px] text-ink-muted">
          {content.propertyHook} · estimated {content.cost}
        </p>
      </div>
      <ApprovalBar messageId={messageId} status={approvalStatus} />
    </div>
  );
}

function MemoryWrite({
  content,
}: {
  content: { headline: string; facts: string[] };
}) {
  return (
    <div className="rw-card overflow-hidden">
      <div className="border-b border-line bg-forest px-5 py-3 text-cream">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold-soft">
          Memory written
        </p>
        <p className="font-serif mt-1 text-[14px] leading-snug text-paper">
          {content.headline}
        </p>
      </div>
      <ul className="space-y-1.5 px-5 py-4">
        {content.facts.map((f) => (
          <li
            key={f}
            className="flex gap-2 text-[13px] leading-6 text-ink"
          >
            <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-gold" />
            {f}
          </li>
        ))}
      </ul>
      <p className="border-t border-line bg-cream/40 px-5 py-2 text-[11px] text-ink-muted">
        Synced to her profile across all Rosewood properties.
      </p>
    </div>
  );
}

function PreloadedMemory({
  content,
}: {
  content: {
    headline: string;
    facts: string[];
    placeAdaptation: string[];
  };
}) {
  return (
    <div className="rw-card overflow-hidden">
      <div className="border-b border-line bg-gold/10 px-5 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
          Preloaded from prior stays
        </p>
        <p className="font-serif mt-1 text-[14px] leading-snug text-forest">
          {content.headline}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            What we remember
          </p>
          <ul className="mt-2 space-y-1.5">
            {content.facts.map((f) => (
              <li
                key={f}
                className="flex gap-2 text-[12.5px] leading-5 text-ink"
              >
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-gold" />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Sense-of-place adaptation
          </p>
          <ul className="mt-2 space-y-1.5">
            {content.placeAdaptation.map((p) => (
              <li
                key={p}
                className="text-[12.5px] leading-5 italic text-clay"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SystemEvent({
  content,
}: {
  content: { label: string; message: string; linkLabel?: string; linkHref?: string };
}) {
  return (
    <div className="rw-card flex items-center justify-between gap-4 px-5 py-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
          {content.label}
        </p>
        <p className="mt-1 text-[13px] text-ink">{content.message}</p>
      </div>
      {content.linkHref && (
        <Link
          href={content.linkHref}
          className="text-[12px] font-medium text-forest underline-offset-4 hover:underline"
        >
          {content.linkLabel ?? "Open"}
        </Link>
      )}
    </div>
  );
}

function ApprovalBar({
  messageId,
  status,
}: {
  messageId: number;
  status: "auto" | "pending" | "approved" | "declined";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status === "auto") return null;
  if (status === "approved") {
    return (
      <div className="flex items-center gap-2 border-t border-line bg-emerald/5 px-5 py-2 text-[11px] uppercase tracking-[0.22em] text-emerald">
        <span className="h-1 w-1 rounded-full bg-emerald" />
        Approved · sent
      </div>
    );
  }
  if (status === "declined") {
    return (
      <div className="border-t border-line bg-clay/5 px-5 py-2 text-[11px] uppercase tracking-[0.22em] text-clay">
        Declined
      </div>
    );
  }

  function act(action: "approve" | "decline") {
    startTransition(async () => {
      await fetch(`/api/messages/${messageId}/approve`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between border-t border-line bg-paper px-5 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.22em] text-amber">
        Awaiting your approval
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => act("decline")}
          disabled={pending}
          className="rounded-sm border border-line bg-paper px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-ink-muted hover:text-clay"
        >
          Adjust
        </button>
        <button
          onClick={() => act("approve")}
          disabled={pending}
          className="rounded-sm bg-forest px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cream hover:bg-forest-deep"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest SMS thread
// ---------------------------------------------------------------------------

export function GuestThread({
  messages,
  guestName,
  propertyName,
}: {
  messages: RenderedMessage[];
  guestName: string;
  propertyName: string;
}) {
  const scrollRef = useAutoScroll(messages.length);
  return (
    <div className="flex h-full flex-col">
      <ThreadHeader
        title={`${guestName} · iMessage`}
        subtitle={`with ${propertyName}`}
      />
      <div
        ref={scrollRef}
        className="rw-scroll flex-1 space-y-3 overflow-y-auto px-6 py-8"
      >
        {messages.length === 0 ? (
          <EmptyHint
            line="The guest's phone is quiet — staff has not pushed anything yet."
          />
        ) : (
          messages.map((m, i) => <GuestBubble key={m.id} message={m} index={i} />)
        )}
      </div>
    </div>
  );
}

function GuestBubble({
  message,
  index,
}: {
  message: RenderedMessage;
  index: number;
}) {
  const fromHotel = message.authorRole === "ai" || message.authorRole === "staff";
  return (
    <div
      className={`rw-enter flex ${fromHotel ? "justify-start" : "justify-end"}`}
      style={{ animationDelay: `${Math.min(index, 7) * 140}ms` }}
    >
      <div className="max-w-[78%]">
        {fromHotel && index === 0 && (
          <p className="mb-1 ml-3 text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Rosewood
          </p>
        )}
        <div
          className={`px-4 py-2.5 text-[14px] leading-5 ${
            fromHotel ? "rw-bubble-guest-incoming" : "rw-bubble-guest-outgoing"
          }`}
        >
          {(message.content as { line: string }).line}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ThreadHeader({
  title,
  subtitle,
  liveDot,
}: {
  title: string;
  subtitle?: string;
  liveDot?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-paper/80 px-6 py-4 backdrop-blur">
      <div>
        <p className="text-[14px] font-medium text-forest">{title}</p>
        {subtitle && (
          <p className="text-[11.5px] text-ink-muted">{subtitle}</p>
        )}
      </div>
      {liveDot && (
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-emerald">
          <span className="rw-pulse inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
          live
        </span>
      )}
    </div>
  );
}

function EmptyHint({ line }: { line: string }) {
  return (
    <div className="mt-8 rounded-sm border border-dashed border-line bg-paper/50 p-5 text-center">
      <p className="text-[12px] italic text-ink-muted">{line}</p>
    </div>
  );
}

function Avatar({ author, role }: { author: string; role: string }) {
  if (role === "ai") {
    return (
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest text-[10px] text-gold-soft">
        ◈
      </div>
    );
  }
  const initials = authorDisplay(author)
    .split(/[\s_]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream text-[10px] font-medium text-forest">
      {initials}
    </div>
  );
}

function authorDisplay(author: string) {
  const map: Record<string, string> = {
    rose: "Rose",
    anya_concierge: "Anya · Concierge",
    philip_front: "Philip · Front Desk",
    eun_spa: "Eun · Asaya",
    maya: "Maya",
  };
  return map[author] ?? author;
}

// ---------------------------------------------------------------------------
// Auto-scroll to bottom when new messages arrive — smoothly.
// ---------------------------------------------------------------------------

function useAutoScroll(messageCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    // Settle the scroll AFTER the entrance animations begin, so the eye
    // tracks the new content arriving rather than snapping past it.
    const t = window.setTimeout(() => {
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [messageCount]);
  return ref;
}

// ---------------------------------------------------------------------------
// Minimal audio player — paper + gold, no chrome.
// ---------------------------------------------------------------------------

function MinimalAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => setDuration(a.duration || 0);
    const onTime = () => {
      setCurrent(a.currentTime);
      setProgress(a.duration ? a.currentTime / a.duration : 0);
    };
    const onEnd = () => setPlaying(false);
    const onErr = () => setError(true);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onErr);
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onErr);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a || error) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(
        () => setPlaying(true),
        () => setError(true),
      );
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(duration, ratio * duration));
  }

  return (
    <div className="mt-3 flex items-center gap-4">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={toggle}
        disabled={error}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/60 bg-paper text-gold hover:bg-gold hover:text-paper disabled:opacity-50"
      >
        {error ? (
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        ) : playing ? (
          <svg viewBox="0 0 12 12" width="10" height="12" aria-hidden>
            <rect x="2" y="1" width="2.5" height="10" fill="currentColor" />
            <rect x="7.5" y="1" width="2.5" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width="10" height="12" aria-hidden>
            <path d="M2 1l9 5-9 5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="flex-1">
        <div
          onClick={seek}
          className="group h-[3px] cursor-pointer rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] tracking-wide text-ink-muted">
          <span>{fmtTime(current)}</span>
          <span>
            {error ? "audio not yet recorded" : fmtTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
