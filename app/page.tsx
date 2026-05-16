import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db";
import { guests, properties, stays } from "@/lib/db/rhythm-schema";
import { isAnthropicConfigured } from "@/lib/ai/anthropic";

import { BeginDemoButton } from "./begin-demo-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rows: Array<{
    stay: typeof stays.$inferSelect;
    guest: typeof guests.$inferSelect;
    property: typeof properties.$inferSelect;
  }> = [];
  let dbError: string | null = null;

  try {
    rows = await db
      .select({ stay: stays, guest: guests, property: properties })
      .from(stays)
      .innerJoin(guests, eq(guests.id, stays.guestId))
      .innerJoin(properties, eq(properties.id, stays.propertyId))
      .orderBy(asc(stays.checkIn));
  } catch (err) {
    dbError = err instanceof Error ? err.message : "unknown DB error";
  }

  const aiReady = isAnthropicConfigured();
  const seeded = rows.length > 0;
  const dbReady = dbError === null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-ivory">
      <BackgroundOrnament />

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10 sm:px-10 sm:py-16">
        {/* Brand */}
        <header className="flex items-center justify-between">
          <span className="rw-monogram text-[12px] tracking-[0.32em] text-forest">
            ROSEWOOD
          </span>
          <span className="text-[10px] uppercase tracking-[0.32em] text-ink-muted">
            Rose · v0.1
          </span>
        </header>

        {/* Hero */}
        <section className="mt-32 sm:mt-40">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
            State-aware hospitality
          </p>
          <h1 className="font-display mt-6 text-5xl leading-[1.05] text-forest sm:text-6xl">
            Hotels remember what
            <br />
            you order.
            <br />
            <span className="text-clay italic">Rosewood will remember</span>
            <br />
            how you arrive.
          </h1>
          <div className="rw-rule mt-10" />
          <p className="font-serif mt-8 max-w-xl text-[1.25rem] leading-relaxed text-ink-soft">
            A discreet layer beneath the existing email, group text, and call —
            so every property choreographs your stay around the state you
            actually arrive in, with consent kept visible and the data kept
            out of sight.
          </p>

          {/* Primary CTA */}
          <div className="mt-12">
            <BeginDemoButton />
          </div>
        </section>

        {/* Status row */}
        <section className="mt-16 flex flex-wrap items-center gap-3">
          <StatusPill
            ok={dbReady}
            on="Database connected"
            off="DB not reachable — run `npm run db:push` then POST /api/seed"
          />
          <StatusPill
            ok={aiReady}
            on="Claude · concierge synthesis active"
            off="Set ANTHROPIC_API_KEY to enable live synthesis (fallback content is rendering)"
          />
          <StatusPill
            ok={seeded}
            on={`${rows.length} stay${rows.length === 1 ? "" : "s"} seeded`}
            off={dbReady ? "POST /api/seed to load the demo" : "—"}
          />
        </section>

        {/* Stays */}
        <section className="mt-12">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
            Existing stays
          </p>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Each row opens directly into the concierge thread (the demo
            surface). Use <em className="not-italic font-medium">Begin the demo</em> above to
            reset state mid-rehearsal.
          </p>

          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="mt-6 space-y-3">
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
                    scene={stay.demoScene}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-auto pt-16 text-[11px] text-ink-muted">
          <p>
            Built for Hospitality 2030 · Rosewood Sand Hill · 16 May 2026 ·{" "}
            <Link href="/privacy" className="underline-offset-4 hover:text-ink">
              How we handle data
            </Link>
          </p>
        </footer>
      </div>
    </main>
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
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${
        ok
          ? "border-emerald/30 bg-emerald/5 text-emerald"
          : "border-amber/30 bg-amber/5 text-amber"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          ok ? "bg-emerald" : "bg-amber"
        }`}
      />
      {ok ? on : off}
    </span>
  );
}

function StayRow({
  stayId,
  guestName,
  propertyName,
  city,
  checkIn,
  checkOut,
  phase,
  scene,
}: {
  stayId: number;
  guestName: string;
  propertyName: string;
  city: string;
  checkIn: Date;
  checkOut: Date;
  phase: string;
  scene: number;
}) {
  const range = `${checkIn.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${checkOut.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return (
    <div className="rw-card flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4 transition-colors hover:border-gold">
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
          {range}
        </p>
        <p className="mt-0.5">
          {phase} · scene {scene}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/stay/${stayId}/connect`}
          className="rounded-sm border border-line bg-paper px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-ink-soft hover:text-forest"
        >
          Guest view
        </Link>
        <Link
          href={`/admin/stays/${stayId}`}
          className="rounded-sm bg-forest px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] text-cream hover:bg-forest-deep"
        >
          Open concierge thread →
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-sm border border-dashed border-line bg-paper/50 p-8 text-center">
      <p className="font-serif text-[1.125rem] italic text-ink-soft">
        No stays loaded yet.
      </p>
      <p className="mt-2 text-[13px] text-ink-muted">
        Run{" "}
        <code className="rounded bg-cream px-1.5 py-0.5 text-[12px]">
          curl -X POST http://localhost:3000/api/seed
        </code>{" "}
        to load Maya at Sand Hill (the demo guest) and the second-stay handoff
        at Rosewood Hong Kong.
      </p>
    </div>
  );
}

function BackgroundOrnament() {
  return (
    <>
      <div
        aria-hidden
        className="rw-breathe pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(176,137,72,0.22), transparent 55%), radial-gradient(ellipse at bottom left, rgba(44,58,46,0.14), transparent 60%)",
        }}
      />
    </>
  );
}
