import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  consentRecords,
  guests,
  intakeAnswers,
  memoryFacts,
  messages,
  properties,
  signals,
  stays,
} from "@/lib/db/rhythm-schema";

import { StaffThread } from "./message-renderer";
import { type AdminStayTab, TabNav, parseTab } from "./tab-nav";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string | string[] }>;

export default async function AdminStayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const stayId = Number(id);
  if (!Number.isFinite(stayId)) return notFound();

  const sp = await searchParams;
  const tab = parseTab(sp.tab);

  const [row] = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);

  if (!row) return notFound();

  // Pull every per-stay record once; each tab reads what it needs.
  const [
    allMessages,
    allConsents,
    [latestIntake],
    guestSignals,
    memory,
  ] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.stayId, stayId))
      .orderBy(asc(messages.thread), asc(messages.sceneOrder)),
    db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.stayId, stayId))
      .orderBy(desc(consentRecords.connectedAt)),
    db
      .select()
      .from(intakeAnswers)
      .where(eq(intakeAnswers.stayId, stayId))
      .orderBy(desc(intakeAnswers.capturedAt))
      .limit(1),
    db
      .select()
      .from(signals)
      .where(eq(signals.guestId, row.guest.id))
      .orderBy(desc(signals.capturedAt)),
    db
      .select()
      .from(memoryFacts)
      .where(eq(memoryFacts.guestId, row.guest.id))
      .orderBy(desc(memoryFacts.createdAt))
      .limit(20),
  ]);

  const staffMessages = allMessages.filter((m) => m.thread === "staff");
  const activeConsent = allConsents.find((c) => c.active) ?? allConsents[0];
  const intakeAnswerData = (latestIntake?.answers ?? null) as IntakeShape | null;

  return (
    <main className="flex min-h-screen flex-col bg-ivory">
      {/* Top bar — unchanged identity */}
      <header className="border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Concierge group · staff view
          </span>

          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-ink-muted">|</span>
            <span className="font-medium text-forest">{row.property.name}</span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-soft">{row.guest.name}</span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-soft">
              {formatRange(row.stay.checkIn, row.stay.checkOut)}
            </span>
            {row.stay.occasion && (
              <>
                <span className="text-ink-muted">·</span>
                <span
                  className="rw-tag"
                  style={{ background: "transparent" }}
                >
                  {row.stay.occasion.replace(/_/g, " ")}
                </span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {activeConsent && (
              <ConsentChip
                source={activeConsent.source}
                active={activeConsent.active}
                disconnectAt={activeConsent.autoDisconnectAt}
              />
            )}
            <MemoryChip count={memory.length} />
          </div>
        </div>
      </header>

      <TabNav stayId={stayId} current={tab} />

      <section className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-8">
        {tab === "overview" && (
          <OverviewTab
            stay={row.stay}
            guest={row.guest}
            property={row.property}
            consents={allConsents}
            intake={intakeAnswerData}
            memory={memory}
            staffPendingCount={
              staffMessages.filter((m) => m.approvalStatus === "pending").length
            }
            voiceCallCount={
              staffMessages.filter((m) => m.kind === "voice_call").length
            }
          />
        )}

        {tab === "history" && (
          <HistoryTab
            stay={row.stay}
            consents={allConsents}
            intake={latestIntake ?? null}
            messages={staffMessages.map(serializeMessage)}
            signals={guestSignals}
          />
        )}

        {tab === "insights" && (
          <InsightsTab
            guest={row.guest}
            intake={intakeAnswerData}
            intakeMeta={latestIntake ?? null}
            memory={memory}
            signals={guestSignals}
          />
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab: OVERVIEW
// ---------------------------------------------------------------------------

function OverviewTab({
  stay,
  guest,
  property,
  consents,
  intake,
  memory,
  staffPendingCount,
  voiceCallCount,
}: {
  stay: typeof stays.$inferSelect;
  guest: typeof guests.$inferSelect;
  property: typeof properties.$inferSelect;
  consents: (typeof consentRecords.$inferSelect)[];
  intake: IntakeShape | null;
  memory: (typeof memoryFacts.$inferSelect)[];
  staffPendingCount: number;
  voiceCallCount: number;
}) {
  const activeConsents = consents.filter((c) => c.active);

  return (
    <div className="space-y-8">
      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Stat label="Phase" value={prettyPhase(stay.phase)} accent="moss" />
        <Stat
          label="Pending approvals"
          value={String(staffPendingCount)}
          accent={staffPendingCount > 0 ? "amber" : "ink"}
        />
      </div>

      {/* Two-column body */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: AI brief + vibe */}
        <Section title="What we know">
          {intake?.summary ? (
            <p className="font-serif text-[15px] leading-relaxed text-ink-soft">
              {intake.summary}
            </p>
          ) : (
            <EmptyLine text="No intake captured yet." />
          )}

          {intake && (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <KV label="Arrival vibe" value={intake.arrivalVibe} />
              <KV label="Pacing" value={intake.pacing} />
              <KV label="Scent" value={intake.scent} />
              <KV
                label="Contact"
                value={intake.contactPreference ?? guest.contactPreference}
              />
              {intake.comfortFlags && intake.comfortFlags.length > 0 && (
                <KV
                  label="Comfort"
                  value={intake.comfortFlags
                    .map((f) => f.replace(/_/g, " "))
                    .join(", ")}
                  span={2}
                />
              )}
              {intake.experiencesRequested &&
                intake.experiencesRequested.length > 0 && (
                  <KV
                    label="Wants"
                    value={intake.experiencesRequested.join(" · ")}
                    span={2}
                  />
                )}
            </dl>
          )}
        </Section>

        {/* Right: connected sources + travel */}
        <Section title="Travel & sources">
          <dl className="grid grid-cols-1 gap-y-3 text-[13px]">
            <KV
              label="Stay"
              value={`${formatRange(stay.checkIn, stay.checkOut)} · ${property.name}${stay.roomNumber ? ` · ${stay.roomNumber}` : ""}`}
            />
            <KV label="Occasion" value={prettyOccasion(stay.occasion)} />
            <KV label="Flight" value={renderFlight(intake?.flight)} />
            <KV label="Companion" value={renderCompanion(intake?.companion)} />
          </dl>

          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Data sources
            </p>
            <ul className="mt-3 space-y-2">
              {consents.length === 0 && (
                <EmptyLine text="No data sources connected." />
              )}
              {consents.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-paper px-3 py-2 text-[12px]"
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      c.active ? "bg-emerald" : "bg-ink-muted"
                    }`}
                  />
                  <span className="font-medium text-forest">
                    {prettySource(c.source)}
                  </span>
                  <span className="text-ink-muted">
                    {c.active ? "live" : "disconnected"}
                  </span>
                  <span className="text-ink-muted">·</span>
                  <span className="text-ink-muted">
                    auto-disconnect{" "}
                    {c.autoDisconnectAt.toLocaleString("en-US", {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>

      {/* Memory carryover */}
      <Section title="Memory carryover">
        {memory.length === 0 ? (
          <EmptyLine text="No prior facts on file." />
        ) : (
          <ul className="space-y-2">
            {memory.slice(0, 5).map((m) => (
              <li
                key={m.id}
                className="rounded-sm border border-line bg-paper px-3 py-2 text-[13px]"
              >
                <span className="text-[10px] uppercase tracking-[0.2em] text-gold">
                  {m.kind.replace(/_/g, " ")}
                </span>
                <p className="mt-1 text-ink">{m.fact}</p>
              </li>
            ))}
            {memory.length > 5 && (
              <li className="text-[12px] text-ink-muted">
                +{memory.length - 5} more — see the Insights tab.
              </li>
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: HISTORY
// ---------------------------------------------------------------------------

interface SerializedMessage {
  id: number;
  thread: "staff" | "guest";
  author: string;
  authorRole: "ai" | "staff" | "guest";
  kind: string;
  content: Record<string, unknown>;
  approvalStatus: "auto" | "pending" | "approved" | "declined";
  createdAt: string;
}

interface TimelineEvent {
  id: string;
  at: Date;
  category: "consent" | "intake" | "voice_call" | "signal" | "stay";
  title: string;
  detail?: string;
}

function HistoryTab({
  stay,
  consents,
  intake,
  messages: staffMessages,
  signals: guestSignals,
}: {
  stay: typeof stays.$inferSelect;
  consents: (typeof consentRecords.$inferSelect)[];
  intake: typeof intakeAnswers.$inferSelect | null;
  messages: SerializedMessage[];
  signals: (typeof signals.$inferSelect)[];
}) {
  // Build a unified, reverse-chronological event timeline alongside the
  // existing staff thread (kept on this page so the full conversation
  // stays accessible without bouncing between routes).
  const events: TimelineEvent[] = [];

  events.push({
    id: `stay-${stay.id}`,
    at: stay.createdAt,
    category: "stay",
    title: "Stay created",
    detail: `Phase ${prettyPhase(stay.phase)} · scene #${stay.demoScene}`,
  });

  for (const c of consents) {
    events.push({
      id: `consent-${c.id}`,
      at: c.connectedAt,
      category: "consent",
      title: `${prettySource(c.source)} ${c.active ? "connected" : "disconnected"}`,
      detail: `auto-disconnect ${c.autoDisconnectAt.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}${c.notes ? ` · ${c.notes}` : ""}`,
    });
  }

  if (intake) {
    events.push({
      id: `intake-${intake.id}`,
      at: intake.capturedAt,
      category: "intake",
      title: "Pre-arrival intake captured",
      detail: `via ${intake.source.replace(/_/g, " ")}`,
    });
  }

  for (const s of guestSignals) {
    const payload = s.payload as Record<string, unknown>;
    const summary = signalSummary(payload);
    events.push({
      id: `signal-${s.id}`,
      at: s.capturedAt,
      category: "signal",
      title: `${prettySource(s.source)} signal snapshot`,
      detail: summary,
    });
  }

  for (const m of staffMessages) {
    if (m.kind === "voice_call") {
      const c = m.content as {
        label?: string;
        duration?: string;
        to?: string;
      };
      events.push({
        id: `msg-${m.id}`,
        at: new Date(m.createdAt),
        category: "voice_call",
        title: c.label ?? "Voice call",
        detail: `${c.to ? `to ${c.to}` : ""}${
          c.duration ? ` · ${c.duration}` : ""
        }`,
      });
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-10">
      <Section title="Event timeline">
        {events.length === 0 ? (
          <EmptyLine text="No events recorded yet." />
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-4 rounded-sm border border-line bg-paper px-4 py-3"
              >
                <span
                  className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${eventDotClass(
                    e.category,
                  )}`}
                />
                <div className="flex-1">
                  <p className="text-[13.5px] text-forest">{e.title}</p>
                  {e.detail && (
                    <p className="mt-0.5 text-[12px] text-ink-muted">
                      {e.detail}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[10.5px] uppercase tracking-[0.18em] text-ink-muted">
                  {formatStamp(e.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Concierge thread">
        <p className="mb-4 text-[12px] text-ink-muted">
          The full AI / staff conversation, scene by scene.
        </p>
        <div className="-mx-6">
          <StaffThread messages={staffMessages} />
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: INSIGHTS
// ---------------------------------------------------------------------------

function InsightsTab({
  guest,
  intake,
  intakeMeta,
  memory,
  signals: guestSignals,
}: {
  guest: typeof guests.$inferSelect;
  intake: IntakeShape | null;
  intakeMeta: typeof intakeAnswers.$inferSelect | null;
  memory: (typeof memoryFacts.$inferSelect)[];
  signals: (typeof signals.$inferSelect)[];
}) {
  return (
    <div className="space-y-10">
      {/* Identifiers */}
      <Section title="Guest identifiers">
        <dl className="grid grid-cols-1 gap-y-3 text-[13px] sm:grid-cols-2">
          <KV label="Name" value={guest.name} />
          <KV label="Email" value={guest.email} />
          <KV label="Phone" value={guest.phone} />
          <KV
            label="Contact preference"
            value={guest.contactPreference}
          />
          <KV
            label="Merged profiles"
            value={String(guest.mergedProfileCount)}
          />
          <KV
            label="Created"
            value={guest.createdAt.toLocaleString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          />
        </dl>
      </Section>

      {/* Form answers */}
      <Section title="Pre-arrival form answers">
        {!intake ? (
          <EmptyLine text="Guest has not submitted intake yet." />
        ) : (
          <>
            {intakeMeta && (
              <p className="mb-4 text-[11.5px] text-ink-muted">
                Captured {formatStamp(intakeMeta.capturedAt)} via{" "}
                {intakeMeta.source.replace(/_/g, " ")}.
              </p>
            )}
            <dl className="grid grid-cols-1 gap-y-3 text-[13px] sm:grid-cols-2">
              <KV label="Arrival vibe" value={intake.arrivalVibe} />
              <KV label="Pacing" value={intake.pacing} />
              <KV label="Occasion" value={intake.occasion} />
              <KV
                label="Contact preference"
                value={intake.contactPreference}
              />
              <KV label="Scent" value={intake.scent} />
              <KV label="Wake window" value={intake.wakeWindow} />
              <KV label="Evening window" value={intake.eveningWindow} />
              <KV
                label="Comfort flags"
                value={
                  intake.comfortFlags && intake.comfortFlags.length
                    ? intake.comfortFlags
                        .map((f) => f.replace(/_/g, " "))
                        .join(", ")
                    : null
                }
                span={2}
              />
              <KV
                label="Avoid"
                value={
                  intake.avoid && intake.avoid.length
                    ? intake.avoid.join(", ")
                    : null
                }
                span={2}
              />
              <KV
                label="Food preferences"
                value={
                  intake.foodPreferences && intake.foodPreferences.length
                    ? intake.foodPreferences.join(", ")
                    : null
                }
                span={2}
              />
              <KV
                label="Experiences requested"
                value={
                  intake.experiencesRequested &&
                  intake.experiencesRequested.length
                    ? intake.experiencesRequested.join(", ")
                    : null
                }
                span={2}
              />
              <KV label="Flight" value={renderFlight(intake.flight)} span={2} />
              <KV
                label="Companion"
                value={renderCompanion(intake.companion)}
                span={2}
              />
              <KV label="Summary" value={intake.summary} span={2} />
            </dl>
          </>
        )}
      </Section>

      {/* Memory facts */}
      <Section title={`Memory facts (${memory.length})`}>
        {memory.length === 0 ? (
          <EmptyLine text="No memory carried over yet." />
        ) : (
          <ul className="space-y-2">
            {memory.map((m) => (
              <li
                key={m.id}
                className="rounded-sm border border-line bg-paper px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-gold">
                    {m.kind.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10.5px] uppercase tracking-[0.18em] text-ink-muted">
                    confidence {Math.round(m.confidence * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink">{m.fact}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  added {formatStamp(m.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Whoop / signal payloads */}
      <Section title={`Health signal snapshots (${guestSignals.length})`}>
        <p className="mb-4 text-[12px] text-ink-muted">
          Internal payloads from connected sources. Translated into pacing
          language for staff — never shown raw to the guest.
        </p>
        {guestSignals.length === 0 ? (
          <EmptyLine text="No signal snapshots captured yet." />
        ) : (
          <ul className="space-y-3">
            {guestSignals.map((s) => (
              <li
                key={s.id}
                className="rounded-sm border border-line bg-paper px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald">
                      {prettySource(s.source)}
                    </span>
                    <span className="text-[11.5px] text-ink-muted">
                      captured {formatStamp(s.capturedAt)}
                    </span>
                  </div>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-sm bg-cream/60 p-3 text-[11.5px] leading-5 text-ink">
                  {JSON.stringify(s.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI bits
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "moss" | "gold" | "ink" | "emerald" | "amber";
}) {
  const colorClass = {
    moss: "text-moss",
    gold: "text-gold",
    ink: "text-forest",
    emerald: "text-emerald",
    amber: "text-amber",
  }[accent];
  return (
    <div className="rounded-sm border border-line bg-paper px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        {label}
      </p>
      <p className={`font-display mt-2 text-2xl leading-none ${colorClass}`}>
        {value}
      </p>
    </div>
  );
}

function KV({
  label,
  value,
  span = 1,
}: {
  label: string;
  value: string | null | undefined;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? "sm:col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1 text-ink">
        {value && value.trim() ? value : <span className="text-ink-muted">—</span>}
      </dd>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="font-serif text-[13.5px] italic text-ink-muted">{text}</p>
  );
}

function ConsentChip({
  source,
  active,
  disconnectAt,
}: {
  source: string;
  active: boolean;
  disconnectAt: Date;
}) {
  return (
    <span
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10.5px] uppercase tracking-[0.2em] ${
        active
          ? "border-emerald/30 bg-emerald/5 text-emerald"
          : "border-line bg-cream text-ink-muted"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          active ? "bg-emerald" : "bg-ink-muted"
        }`}
      />
      {source} {active ? "live" : "disconnected"}
      <span className="text-ink-muted">
        ·{" "}
        {disconnectAt.toLocaleString("en-US", {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </span>
  );
}

function MemoryChip({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[10.5px] uppercase tracking-[0.2em] text-ink-soft">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
      {count} facts remembered
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IntakeShape {
  arrivalVibe?: string | null;
  pacing?: string | null;
  occasion?: string | null;
  scent?: string | null;
  contactPreference?: string | null;
  wakeWindow?: string | null;
  eveningWindow?: string | null;
  summary?: string | null;
  comfortFlags?: string[];
  avoid?: string[];
  foodPreferences?: string[];
  experiencesRequested?: string[];
  flight?: {
    number?: string | null;
    origin?: string | null;
    destination?: string | null;
    arrivalTime?: string | null;
  } | null;
  companion?: {
    name?: string | null;
    relationship?: string | null;
    note?: string | null;
  } | null;
}

function formatRange(a: Date, b: Date) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} → ${b.toLocaleDateString("en-US", opts)}`;
}

function formatStamp(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function prettyPhase(phase: string): string {
  return (
    {
      pre: "pre-arrival",
      in: "in residence",
      post: "post-stay",
      closed: "closed",
    }[phase] ?? phase
  );
}

function prettyOccasion(o: string | null): string | null {
  if (!o) return null;
  return o.replace(/_/g, " ");
}

function prettySource(source: string): string {
  return (
    {
      whoop: "Whoop",
      apple: "Apple Health",
      oura: "Oura",
      garmin: "Garmin",
      fitbit: "Fitbit",
      conversational: "Conversational",
    }[source] ?? source
  );
}

function renderFlight(flight: IntakeShape["flight"]): string | null {
  if (!flight || !flight.number) return null;
  const route =
    flight.origin && flight.destination
      ? `${flight.origin} → ${flight.destination}`
      : "";
  const arr = flight.arrivalTime ? `, lands ${flight.arrivalTime}` : "";
  return `${flight.number}${route ? ` · ${route}` : ""}${arr}`;
}

function renderCompanion(
  companion: IntakeShape["companion"],
): string | null {
  if (!companion || !companion.name) return null;
  const rel = companion.relationship ? ` (${companion.relationship})` : "";
  const note = companion.note ? ` — ${companion.note}` : "";
  return `${companion.name}${rel}${note}`;
}

function signalSummary(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.recoveryBand === "string")
    parts.push(`recovery ${payload.recoveryBand}`);
  if (typeof payload.travelStrain === "string")
    parts.push(`strain ${payload.travelStrain}`);
  if (typeof payload.sleepMinutes === "number")
    parts.push(`sleep ${Math.round(payload.sleepMinutes / 60)}h`);
  if (typeof payload.sleepQuality === "string")
    parts.push(`quality ${payload.sleepQuality}`);
  return parts.join(" · ") || "snapshot recorded";
}

function eventDotClass(
  category: TimelineEvent["category"],
): string {
  return (
    {
      consent: "bg-emerald",
      intake: "bg-gold",
      voice_call: "bg-clay",
      signal: "bg-moss",
      stay: "bg-ink-muted",
    }[category] ?? "bg-line"
  );
}

function serializeMessage(m: typeof messages.$inferSelect): SerializedMessage {
  return {
    id: m.id,
    thread: m.thread as "staff" | "guest",
    author: m.author,
    authorRole: m.authorRole as "ai" | "staff" | "guest",
    kind: m.kind,
    content: m.content as Record<string, unknown>,
    approvalStatus: m.approvalStatus as
      | "auto"
      | "pending"
      | "approved"
      | "declined",
    createdAt: m.createdAt.toISOString(),
  };
}
