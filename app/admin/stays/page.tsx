import { and, asc, eq, type SQL } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db";
import { guests, properties, stays } from "@/lib/db/rhythm-schema";

import { PropertyPicker } from "../property-picker";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  property?: string | string[];
  phase?: string | string[];
}>;

const PHASE_OPTIONS = [
  { key: "all", label: "All phases" },
  { key: "pre", label: "Pre-arrival" },
  { key: "in", label: "In residence" },
  { key: "post", label: "Post-stay" },
  { key: "closed", label: "Closed" },
] as const;

const PHASE_LABELS: Record<string, string> = {
  pre: "pre-arrival",
  in: "in residence",
  post: "post-stay",
  closed: "closed",
};

export default async function AdminStaysListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedSlug = first(params.property);
  const requestedPhase = first(params.phase);
  const phaseFilter =
    requestedPhase &&
    ["pre", "in", "post", "closed"].includes(requestedPhase)
      ? requestedPhase
      : null;

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

  const selectedProperty = requestedSlug
    ? (allProperties.find((p) => p.slug === requestedSlug) ?? null)
    : null;

  const conditions: SQL[] = [];
  if (selectedProperty)
    conditions.push(eq(stays.propertyId, selectedProperty.id));
  if (phaseFilter) conditions.push(eq(stays.phase, phaseFilter));

  const rows = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(asc(stays.checkIn));

  const buildPhaseHref = (phaseKey: string) => {
    const sp = new URLSearchParams();
    if (selectedProperty) sp.set("property", selectedProperty.slug);
    if (phaseKey !== "all") sp.set("phase", phaseKey);
    const qs = sp.toString();
    return qs ? `/admin/stays?${qs}` : "/admin/stays";
  };

  const dashboardHref = selectedProperty
    ? `/admin?property=${selectedProperty.slug}`
    : "/admin";

  return (
    <main className="flex min-h-screen flex-col bg-ivory">
      <header className="border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Admin · all stays
          </span>
          <div className="ml-auto flex items-center gap-3">
            <PropertyPicker
              showAllOption
              properties={allProperties.map((p) => ({
                slug: p.slug,
                name: p.name,
                city: p.city,
              }))}
              current={selectedProperty?.slug ?? null}
            />
            <Link
              href={dashboardHref}
              className="rounded-sm border border-line bg-paper px-3 py-1.5 text-[10.5px] uppercase tracking-[0.2em] text-ink-soft hover:border-gold hover:text-forest"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] px-6 py-10">
        {/* Title */}
        <section className="flex flex-wrap items-end justify-between gap-y-3">
          <div>
            <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
              Stays
            </p>
            <h1 className="font-display mt-2 text-4xl leading-tight text-forest">
              {selectedProperty
                ? selectedProperty.name
                : "All Rosewood properties"}
            </h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              {rows.length} stay{rows.length === 1 ? "" : "s"}
              {phaseFilter ? ` · ${PHASE_LABELS[phaseFilter]}` : ""}
            </p>
          </div>
        </section>

        <div className="rw-rule mt-8" />

        {/* Phase filter row */}
        <section className="mt-8 flex flex-wrap items-center gap-2">
          {PHASE_OPTIONS.map((opt) => {
            const active =
              opt.key === "all" ? phaseFilter === null : phaseFilter === opt.key;
            return (
              <Link
                key={opt.key}
                href={buildPhaseHref(opt.key)}
                className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] ${
                  active
                    ? "border-forest bg-forest text-cream"
                    : "border-line bg-paper text-ink-soft hover:border-gold hover:text-forest"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </section>

        {/* List */}
        <section className="mt-8">
          {rows.length === 0 ? (
            <div className="rw-card p-10 text-center">
              <p className="font-serif text-[1.125rem] italic text-ink-soft">
                No stays match these filters.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map(({ stay, guest, property }) => (
                <li key={stay.id}>
                  <StayRow
                    stayId={stay.id}
                    guestName={guest.name}
                    propertyName={property.name}
                    city={property.city}
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
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function StayRow({
  stayId,
  guestName,
  propertyName,
  city,
  checkIn,
  checkOut,
  phase,
  roomNumber,
  occasion,
}: {
  stayId: number;
  guestName: string;
  propertyName: string;
  city: string;
  checkIn: Date;
  checkOut: Date;
  phase: string;
  roomNumber: string | null;
  occasion: string | null;
}) {
  return (
    <Link
      href={`/admin/stays/${stayId}`}
      className="rw-card flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4 transition-colors hover:border-gold"
    >
      <div className="min-w-[180px] flex-1">
        <p className="font-serif text-[1.125rem] leading-snug text-forest">
          {guestName}
        </p>
        <p className="text-[12.5px] text-ink-muted">
          {propertyName} · {city}
        </p>
      </div>
      <div className="text-[12px] text-ink-soft">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          {formatRange(checkIn, checkOut)}
        </p>
        <p className="mt-0.5">
          {roomNumber ? `room ${roomNumber}` : "room TBD"}
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
            Admin · all stays
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
