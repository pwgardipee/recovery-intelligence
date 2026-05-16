import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { guests, properties, stays } from "@/lib/db/rhythm-schema";
import { SCENE_TITLES } from "@/lib/rhythm/scenes";
import { isAnthropicConfigured } from "@/lib/ai/anthropic";

import { ControlPanel } from "./control-panel";

export const dynamic = "force-dynamic";

export default async function ControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stayId = Number(id);
  if (!Number.isFinite(stayId)) return notFound();

  const [row] = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);

  if (!row) return notFound();

  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || null;
  const aiReady = isAnthropicConfigured();

  return (
    <main className="relative min-h-screen overflow-hidden bg-ivory">
      <div
        aria-hidden
        className="rw-breathe pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(176,137,72,0.18), transparent 55%), radial-gradient(ellipse at bottom left, rgba(44,58,46,0.12), transparent 60%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10 sm:px-10 sm:py-14">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
          >
            ROSEWOOD · ROSE
          </Link>
          <span className="text-[10px] uppercase tracking-[0.32em] text-ink-muted">
            Presenter remote
          </span>
        </header>

        <section className="mt-12">
          <p className="text-[0.625rem] uppercase tracking-[0.32em] text-gold">
            Live demo · {row.property.name}
          </p>
          <h1 className="font-display mt-3 text-3xl leading-tight text-forest sm:text-4xl">
            {row.guest.name}
          </h1>
          <p className="font-serif mt-3 text-[16px] leading-relaxed text-ink-soft">
            Open the two screens below in separate windows, then drive the
            demo from this remote.
          </p>
        </section>

        {/* Screen openers */}
        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScreenLink
            label="Concierge thread"
            sub="left screen · staff view"
            href={`/admin/stays/${stayId}`}
          />
          <ScreenLink
            label="Guest experience"
            sub="middle screen · the guest's phone & inbox"
            href={`/user/stays/${stayId}`}
          />
        </section>

        <ControlPanel
          stayId={stayId}
          currentScene={row.stay.demoScene}
          totalScenes={SCENE_TITLES.length}
          sceneTitles={[...SCENE_TITLES]}
          agentId={agentId}
          guestName={row.guest.name}
          guestPhone={row.guest.phone}
          aiReady={aiReady}
        />

        <footer className="mt-auto pt-12 text-[11px] text-ink-muted">
          <p>
            Tip: leave this remote open on a third monitor or tucked behind
            the demo screen. Each button below is one beat of the script.
          </p>
        </footer>
      </div>
    </main>
  );
}

function ScreenLink({
  label,
  sub,
  href,
}: {
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rw-card group flex items-center justify-between gap-3 px-5 py-4 hover:border-gold"
    >
      <div>
        <p className="font-serif text-[16px] leading-snug text-forest">
          {label}
        </p>
        <p className="text-[11.5px] text-ink-muted">{sub}</p>
      </div>
      <svg
        width="22"
        height="14"
        viewBox="0 0 22 14"
        fill="none"
        className="text-gold transition-transform group-hover:translate-x-1"
      >
        <path
          d="M1 7h19m0 0L14 1m6 6l-6 6"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}
