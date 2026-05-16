import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db";
import {
  consentRecords,
  guests,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";

import { PropertyPicker } from "./property-picker";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ property?: string | string[] }>;

const PHASE_LABELS: Record<string, string> = {
  pre: "pre-arrival",
  in: "in residence",
  post: "post-stay",
  closed: "closed",
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedSlug = first(params.property);

  let allProperties: (typeof properties.$inferSelect)[] = [];
  let dbError: string | null = null;
  try {
    allProperties = await db
      .select()
      .from(properties)
      .orderBy(asc(properties.name));
  } catch (err) {
    dbError = err instanceof Error ? err.message : "unknown DB error";
  }

  if (dbError || allProperties.length === 0) {
    return <SetupNeeded reason={dbError ?? "no_properties"} />;
  }

  // Default to Sand Hill (Menlo Park) — the demo home property — when no
  // explicit ?property selection has been made. Falls through to alphabetical
  // first only if Sand Hill hasn't been seeded.
  const selected =
    allProperties.find((p) => p.slug === requestedSlug) ??
    allProperties.find((p) => p.slug === "sand-hill") ??
    allProperties[0];

  const propertyId = selected.id;
  const startOfToday = startOfDayUtc();
  const sevenDaysOut = new Date(
    startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000,
  );

  const [
    activeCountRow,
    arrivingTodayCountRow,
    arrivingSoonCountRow,
    pendingCountRow,
    activeConsentCountRow,
    inResidence,
    arrivingSoon,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(stays)
      .where(and(eq(stays.propertyId, propertyId), eq(stays.phase, "in"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(stays)
      .where(
        and(
          eq(stays.propertyId, propertyId),
          gte(stays.checkIn, startOfToday),
          lt(stays.checkIn, addDays(startOfToday, 1)),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(stays)
      .where(
        and(
          eq(stays.propertyId, propertyId),
          gte(stays.checkIn, startOfToday),
          lt(stays.checkIn, sevenDaysOut),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(stays, eq(stays.id, messages.stayId))
      .where(
        and(
          eq(stays.propertyId, propertyId),
          eq(messages.approvalStatus, "pending"),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(consentRecords)
      .innerJoin(stays, eq(stays.id, consentRecords.stayId))
      .where(
        and(
          eq(stays.propertyId, propertyId),
          eq(consentRecords.active, true),
        ),
      ),
    db
      .select({ stay: stays, guest: guests })
      .from(stays)
      .innerJoin(guests, eq(guests.id, stays.guestId))
      .where(and(eq(stays.propertyId, propertyId), eq(stays.phase, "in")))
      .orderBy(asc(stays.checkOut))
      .limit(5),
    db
      .select({ stay: stays, guest: guests })
      .from(stays)
      .innerJoin(guests, eq(guests.id, stays.guestId))
      .where(
        and(
          eq(stays.propertyId, propertyId),
          gte(stays.checkIn, startOfToday),
          lt(stays.checkIn, sevenDaysOut),
        ),
      )
      .orderBy(asc(stays.checkIn))
      .limit(5),
  ]);

  const stats = {
    inResidence: activeCountRow[0]?.n ?? 0,
    arrivingToday: arrivingTodayCountRow[0]?.n ?? 0,
    arrivingSoon: arrivingSoonCountRow[0]?.n ?? 0,
    pendingApprovals: pendingCountRow[0]?.n ?? 0,
    activeConsents: activeConsentCountRow[0]?.n ?? 0,
  };

  const seeAllHref = `/admin/stays?property=${selected.slug}`;

  return (
    <main className="flex min-h-screen flex-col bg-ivory">
      {/* Top bar */}
      <header className="border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Admin · property dashboard
          </span>
          <div className="ml-auto flex items-center gap-3">
            <PropertyPicker
              properties={allProperties.map((p) => ({
                slug: p.slug,
                name: p.name,
                city: p.city,
              }))}
              current={selected.slug}
            />
            <Link
              href={seeAllHref}
              className="rounded-sm border border-line bg-paper px-3 py-1.5 text-[10.5px] uppercase tracking-[0.2em] text-ink-soft hover:border-gold hover:text-forest"
            >
              See all stays →
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] px-6 py-10">
        {/* Property hero */}
        <section className="flex flex-wrap items-end justify-between gap-y-4">
          <div>
            <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
              {selected.country}
            </p>
            <h1 className="font-display mt-2 text-4xl leading-tight text-forest">
              {selected.name}
            </h1>
            <p className="mt-1 text-[13px] text-ink-muted">{selected.city}</p>
          </div>
          {senseOfPlaceQuote(selected.senseOfPlace) && (
            <p className="font-serif max-w-md text-right text-[1rem] italic leading-relaxed text-ink-soft">
              &ldquo;{senseOfPlaceQuote(selected.senseOfPlace)}&rdquo;
            </p>
          )}
        </section>

        <div className="rw-rule mt-8" />

        {/* Stat strip */}
        <section className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="In residence" value={stats.inResidence} accent="moss" />
          <Stat
            label="Arriving today"
            value={stats.arrivingToday}
            accent="gold"
          />
          <Stat
            label="Arriving · 7 days"
            value={stats.arrivingSoon}
            accent="ink"
          />
          <Stat
            label="Pending approvals"
            value={stats.pendingApprovals}
            accent={stats.pendingApprovals > 0 ? "amber" : "ink"}
          />
          <Stat
            label="Connected signals"
            value={stats.activeConsents}
            accent="emerald"
          />
        </section>

        {/* Two-column lists */}
        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <Panel
            title="In residence"
            subtitle={
              stats.inResidence === 0
                ? "No active stays right now."
                : `${stats.inResidence} guest${stats.inResidence === 1 ? "" : "s"} currently on property.`
            }
            href={seeAllHref + "&phase=in"}
            ctaLabel="See all"
          >
            {inResidence.length === 0 ? (
              <EmptyRow text="Nothing to surface here." />
            ) : (
              <ul className="divide-y divide-line">
                {inResidence.map(({ stay, guest }) => (
                  <li key={stay.id}>
                    <StayLine
                      stayId={stay.id}
                      guestName={guest.name}
                      checkIn={stay.checkIn}
                      checkOut={stay.checkOut}
                      phase={stay.phase}
                      roomNumber={stay.roomNumber}
                      occasion={stay.occasion}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Arriving soon"
            subtitle="Next 7 days · sorted by arrival."
            href={seeAllHref + "&phase=pre"}
            ctaLabel="See all"
          >
            {arrivingSoon.length === 0 ? (
              <EmptyRow text="No upcoming arrivals in the next 7 days." />
            ) : (
              <ul className="divide-y divide-line">
                {arrivingSoon.map(({ stay, guest }) => (
                  <li key={stay.id}>
                    <StayLine
                      stayId={stay.id}
                      guestName={guest.name}
                      checkIn={stay.checkIn}
                      checkOut={stay.checkOut}
                      phase={stay.phase}
                      roomNumber={stay.roomNumber}
                      occasion={stay.occasion}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        <footer className="mt-16 text-[11px] text-ink-muted">
          <Link
            href={seeAllHref}
            className="underline-offset-4 hover:text-ink"
          >
            See all stays at {selected.name} →
          </Link>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers + tiny components
// ---------------------------------------------------------------------------

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function startOfDayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function senseOfPlaceQuote(sop: unknown): string | null {
  if (sop && typeof sop === "object" && "heroQuote" in sop) {
    const v = (sop as { heroQuote?: unknown }).heroQuote;
    return typeof v === "string" ? v : null;
  }
  return null;
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
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
    <div className="rw-card px-5 py-5">
      <p className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        {label}
      </p>
      <p className={`font-display mt-3 text-4xl leading-none ${colorClass}`}>
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  href,
  ctaLabel,
  children,
}: {
  title: string;
  subtitle: string;
  href?: string;
  ctaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rw-card overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div>
          <h2 className="font-display text-2xl leading-tight text-forest">
            {title}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">{subtitle}</p>
        </div>
        {href && ctaLabel && (
          <Link
            href={href}
            className="text-[10.5px] uppercase tracking-[0.2em] text-ink-soft hover:text-forest"
          >
            {ctaLabel} →
          </Link>
        )}
      </div>
      <div className="rw-rule ml-5 mt-4" />
      <div className="px-2 pb-2 pt-2">{children}</div>
    </div>
  );
}

function StayLine({
  stayId,
  guestName,
  checkIn,
  checkOut,
  phase,
  roomNumber,
  occasion,
}: {
  stayId: number;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  phase: string;
  roomNumber: string | null;
  occasion: string | null;
}) {
  return (
    <Link
      href={`/admin/stays/${stayId}`}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-3 transition-colors hover:bg-cream/50"
    >
      <div className="min-w-[160px] flex-1">
        <p className="font-serif text-[1.05rem] leading-snug text-forest">
          {guestName}
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          {formatRange(checkIn, checkOut)}
          {roomNumber ? ` · room ${roomNumber}` : ""}
        </p>
      </div>
      <PhasePill phase={phase} />
      {occasion && (
        <span className="rw-tag" style={{ background: "transparent" }}>
          {occasion.replace(/_/g, " ")}
        </span>
      )}
      <span className="text-[10.5px] uppercase tracking-[0.18em] text-ink-muted">
        Open →
      </span>
    </Link>
  );
}

function PhasePill({ phase }: { phase: string }) {
  const tone =
    phase === "in"
      ? "border-moss/40 bg-moss/10 text-moss"
      : phase === "pre"
        ? "border-gold/40 bg-gold/10 text-gold"
        : phase === "post"
          ? "border-rose/40 bg-rose/10 text-clay"
          : "border-line bg-cream text-ink-muted";
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${tone}`}
    >
      {PHASE_LABELS[phase] ?? phase}
    </span>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="font-serif px-3 py-6 text-center text-[14px] italic text-ink-muted">
      {text}
    </p>
  );
}

function formatRange(a: Date, b: Date) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} → ${b.toLocaleDateString("en-US", opts)}`;
}

function SetupNeeded({ reason }: { reason: string }) {
  const message =
    reason === "no_properties"
      ? "No properties have been seeded yet."
      : `Couldn't read properties: ${reason}`;
  return (
    <main className="flex min-h-screen flex-col bg-ivory">
      <header className="border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-6 py-3">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Admin
          </span>
        </div>
      </header>
      <div className="mx-auto mt-24 max-w-xl px-6">
        <h1 className="font-display text-3xl leading-tight text-forest">
          Setup needed
        </h1>
        <p className="mt-4 text-[14px] text-ink-soft">{message}</p>
        <pre className="mt-6 rounded-sm border border-line bg-paper p-4 text-[12px] text-ink">
          npm run db:push{"\n"}
          curl -X POST {process.env.APP_URL ?? "http://localhost:3000"}
          /api/seed
        </pre>
      </div>
    </main>
  );
}
