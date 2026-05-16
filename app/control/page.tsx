import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { BeginDemoButton } from "@/app/begin-demo-button";
import { db } from "@/lib/db";
import { guests, properties, stays } from "@/lib/db/rhythm-schema";
import { SCENE_TITLES } from "@/lib/rhythm/scenes";

export const dynamic = "force-dynamic";

const PHASE_LABELS: Record<string, string> = {
  pre: "pre-arrival",
  in: "in residence",
  post: "post-stay",
  closed: "closed",
};

export default async function ControlIndexPage() {
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
      .orderBy(asc(properties.name), asc(stays.checkIn));
  } catch (err) {
    dbError = err instanceof Error ? err.message : "unknown DB error";
  }

  const grouped = groupByProperty(rows);

  return (
    <main className="relative min-h-screen overflow-hidden bg-ivory">
      <BackgroundOrnament />

      <header className="relative border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Demo control room
          </span>
          <Link
            href="/admin"
            className="ml-auto rounded-sm border border-line bg-paper px-3 py-1.5 text-[10.5px] uppercase tracking-[0.2em] text-ink-soft hover:border-gold hover:text-forest"
          >
            ← Admin dashboard
          </Link>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-[1100px] px-6 py-12 sm:px-10">
        <section>
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
            Presenter remote
          </p>
          <h1 className="font-display mt-3 text-4xl leading-tight text-forest sm:text-5xl">
            Pick a stay to control.
          </h1>
          <p className="font-serif mt-6 max-w-xl text-[1.125rem] leading-relaxed text-ink-soft">
            Each stay opens its own remote — scene advance, jump-to,
            reset, and a one-tap call to Rose. Use this room only when
            running the demo.
          </p>
        </section>

        <div className="rw-rule mt-10" />

        {/* Begin-demo bootstrap */}
        <section className="mt-10">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
            Fresh demo
          </p>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Reseeds Tavishi at Rosewood Sand Hill and the second-stay
            handoff at Hong Kong, then drops you straight into the
            remote for Tavishi. Safe to run between rehearsals.
          </p>
          <div className="mt-5">
            <BeginDemoButton />
          </div>
        </section>

        {/* Stay picker */}
        <section className="mt-14">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
            Existing stays
          </p>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Grouped by property. Click any row to open its remote.
          </p>

          {dbError && (
            <div className="mt-6 rounded-sm border border-amber/40 bg-amber/5 p-5 text-[13px] text-ink-soft">
              <p className="text-[10.5px] uppercase tracking-[0.2em] text-amber">
                Database not reachable
              </p>
              <p className="mt-2">{dbError}</p>
            </div>
          )}

          {!dbError && rows.length === 0 && (
            <div className="mt-6 rounded-sm border border-dashed border-line bg-paper/50 p-8 text-center">
              <p className="font-serif text-[1.125rem] italic text-ink-soft">
                No stays loaded yet.
              </p>
              <p className="mt-2 text-[13px] text-ink-muted">
                Hit <span className="font-medium">Begin the demo</span>{" "}
                above to seed the demo guests.
              </p>
            </div>
          )}

          {grouped.length > 0 && (
            <div className="mt-8 space-y-12">
              {grouped.map(({ property, stayList }) => (
                <div key={property.id}>
                  <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
                    <div>
                      <h2 className="font-display text-2xl leading-tight text-forest">
                        {property.name}
                      </h2>
                      <p className="mt-0.5 text-[12px] text-ink-muted">
                        {property.city} · {property.country}
                      </p>
                    </div>
                    <span className="text-[10.5px] uppercase tracking-[0.2em] text-ink-muted">
                      {stayList.length} stay
                      {stayList.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <ul className="mt-4 space-y-3">
                    {stayList.map(({ stay, guest }) => (
                      <li key={stay.id}>
                        <ControlRow
                          stayId={stay.id}
                          guestName={guest.name}
                          checkIn={stay.checkIn}
                          checkOut={stay.checkOut}
                          phase={stay.phase}
                          scene={stay.demoScene}
                          totalScenes={SCENE_TITLES.length}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-20 text-[11px] text-ink-muted">
          <p>
            The control room is presenter-only. Guest and staff views
            stay control-free —{" "}
            <Link
              href="/"
              className="underline-offset-4 hover:text-ink"
            >
              back to home
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function groupByProperty(
  rows: Array<{
    stay: typeof stays.$inferSelect;
    guest: typeof guests.$inferSelect;
    property: typeof properties.$inferSelect;
  }>,
): Array<{
  property: typeof properties.$inferSelect;
  stayList: Array<{
    stay: typeof stays.$inferSelect;
    guest: typeof guests.$inferSelect;
  }>;
}> {
  const map = new Map<
    number,
    {
      property: typeof properties.$inferSelect;
      stayList: Array<{
        stay: typeof stays.$inferSelect;
        guest: typeof guests.$inferSelect;
      }>;
    }
  >();
  for (const row of rows) {
    const entry = map.get(row.property.id);
    if (entry) {
      entry.stayList.push({ stay: row.stay, guest: row.guest });
    } else {
      map.set(row.property.id, {
        property: row.property,
        stayList: [{ stay: row.stay, guest: row.guest }],
      });
    }
  }
  return Array.from(map.values());
}

function ControlRow({
  stayId,
  guestName,
  checkIn,
  checkOut,
  phase,
  scene,
  totalScenes,
}: {
  stayId: number;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  phase: string;
  scene: number;
  totalScenes: number;
}) {
  return (
    <Link
      href={`/control/${stayId}`}
      className="rw-card flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4 transition-colors hover:border-gold"
    >
      <div className="min-w-[180px] flex-1">
        <p className="font-serif text-[1.125rem] leading-snug text-forest">
          {guestName}
        </p>
        <p className="text-[12px] text-ink-muted">
          {formatRange(checkIn, checkOut)}
        </p>
      </div>
      <PhasePill phase={phase} />
      <span className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
        Scene {scene} / {totalScenes - 1}
      </span>
      <span className="rounded-sm bg-forest px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] text-cream">
        Open remote →
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

function BackgroundOrnament() {
  return (
    <div
      aria-hidden
      className="rw-breathe pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse at top right, rgba(176,137,72,0.18), transparent 55%), radial-gradient(ellipse at bottom left, rgba(44,58,46,0.12), transparent 60%)",
      }}
    />
  );
}
