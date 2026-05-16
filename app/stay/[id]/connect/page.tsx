import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { guests, properties, stays } from "@/lib/db/rhythm-schema";

import { ConnectOptions } from "./connect-options";

export const dynamic = "force-dynamic";

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stayId = Number(id);
  if (!Number.isFinite(stayId)) return notFound();

  const [row] = await db
    .select({
      stay: stays,
      guest: guests,
      property: properties,
    })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);

  if (!row) return notFound();

  const checkInLong = row.stay.checkIn.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const firstName = row.guest.name.split(" ")[0];

  return (
    <main className="relative min-h-screen overflow-hidden bg-ivory">
      <BackgroundOrnament />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10 sm:px-10 sm:py-16">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link href="/" className="rw-monogram text-sm text-forest">
            ROSEWOOD · SAND HILL
          </Link>
          <span className="text-[0.625rem] uppercase tracking-[0.22em] text-ink-muted">
            Pre-arrival
          </span>
        </header>

        {/* Letter */}
        <section className="mt-24 sm:mt-32">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
            A note from {row.property.name}
          </p>

          <h1 className="font-display mt-6 text-4xl leading-tight text-forest sm:text-5xl">
            {firstName}, we&rsquo;re preparing
            <br />
            for your arrival.
          </h1>

          <div className="rw-rule mt-8" />

          <p className="font-serif mt-8 text-xl leading-relaxed text-ink-soft sm:text-[1.35rem]">
            We&rsquo;d like your stay on {checkInLong} to begin the way you
            actually arrive — quietly if you need quiet, fully if you want
            fullness.
          </p>

          <p className="mt-6 text-[15px] leading-7 text-ink-soft">
            If you&rsquo;re comfortable, share a signal of how you&rsquo;re
            travelling. We use it only to shape the pacing of your time with
            us — never the metric itself, never beyond your stay. If
            you&rsquo;d rather just talk, we&rsquo;ll listen instead.
          </p>
        </section>

        {/* Connect cards */}
        <section className="mt-14">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-ink-muted">
            Choose what suits you
          </p>
          <ConnectOptions
            stayId={stayId}
            firstName={firstName}
            propertyName={row.property.name}
          />
        </section>

        {/* Promise */}
        <section className="mt-14 rounded-sm border border-line bg-paper/60 p-6 sm:p-8">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
            Our promise
          </p>
          <ul className="mt-4 space-y-3 text-[14px] leading-6 text-ink-soft">
            <li className="flex gap-3">
              <Dot />
              We never show staff your raw data. Only thoughtful pacing.
            </li>
            <li className="flex gap-3">
              <Dot />
              We auto-disconnect at the end of your stay.
            </li>
            <li className="flex gap-3">
              <Dot />
              You can disconnect at any moment with a single tap.
            </li>
            <li className="flex gap-3">
              <Dot />
              We will never write to your device or change your data.
            </li>
          </ul>
        </section>

        {/* Footer */}
        <footer className="mt-16 flex items-center justify-between border-t border-line-soft pt-6 text-[11px] tracking-wide text-ink-muted">
          <span>For {row.guest.email}</span>
          <Link
            href="/privacy"
            className="underline-offset-4 hover:text-ink"
          >
            How we handle your information
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Dot() {
  return (
    <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-gold" />
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
            "radial-gradient(ellipse at top right, rgba(176,137,72,0.18), transparent 55%), radial-gradient(ellipse at bottom left, rgba(44,58,46,0.12), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          background:
            "linear-gradient(to bottom, rgba(246,241,231,0.92), transparent)",
        }}
      />
    </>
  );
}
