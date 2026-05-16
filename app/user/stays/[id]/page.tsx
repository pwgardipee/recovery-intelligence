import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  consentRecords,
  guests,
  intakeAnswers,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";

import { PreArrivalForm } from "./pre-arrival-form";
import { GuestPhone } from "./guest-phone";

export const dynamic = "force-dynamic";

export default async function UserStayPage({
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

  const [intake] = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.stayId, stayId))
    .orderBy(asc(intakeAnswers.id))
    .limit(1);

  // Most recent active consent for this stay (e.g. "whoop"). Used to seed
  // the pre-arrival form so the source pill shows "Connected" after OAuth.
  const [activeConsent] = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.stayId, stayId),
        eq(consentRecords.active, true),
      ),
    )
    .orderBy(desc(consentRecords.connectedAt))
    .limit(1);

  const initialConnectedSource = activeConsent?.source ?? null;

  // Guest SMS thread is shown once the stay is "live" (intake done + scene >= 6).
  const showPhoneView = intake && row.stay.demoScene >= 5;

  const guestMessages = showPhoneView
    ? (
        await db
          .select()
          .from(messages)
          .where(eq(messages.stayId, stayId))
          .orderBy(asc(messages.sceneOrder))
      )
        .filter((m) => m.thread === "guest")
        .map((m) => ({
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
        }))
    : [];

  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || null;
  const firstName = row.guest.name.split(" ")[0];

  if (showPhoneView) {
    return (
      <main className="flex min-h-screen flex-col bg-ivory">
        <UserNav
          propertyName={row.property.name}
          guestName={row.guest.name}
        />
        <div className="mx-auto w-full max-w-md flex-1">
          <GuestPhone
            messages={guestMessages}
            guestName={firstName}
            propertyName={row.property.name}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-ivory">
      <BackgroundOrnament />
      <UserNav
        propertyName={row.property.name}
        guestName={row.guest.name}
      />

      <div className="relative mx-auto flex max-w-2xl flex-col px-6 py-10 sm:px-10 sm:py-14">
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
          We&rsquo;d like your stay on{" "}
          {row.stay.checkIn.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          to begin the way you actually arrive — quietly if you need quiet,
          fully if you want fullness.
        </p>

        <PreArrivalForm
          stayId={stayId}
          guestName={row.guest.name}
          guestPhone={row.guest.phone}
          propertyName={row.property.name}
          agentId={agentId}
          alreadySubmitted={Boolean(intake)}
          initialConnectedSource={initialConnectedSource}
        />

        <footer className="mt-16 flex items-center justify-between border-t border-line-soft pt-6 text-[11px] tracking-wide text-ink-muted">
          <span>For {row.guest.email}</span>
          <Link href="/privacy" className="underline-offset-4 hover:text-ink">
            How we handle your information
          </Link>
        </footer>
      </div>
    </main>
  );
}

function UserNav({
  propertyName,
  guestName,
}: {
  propertyName: string;
  guestName: string;
}) {
  return (
    <header className="relative z-10 border-b border-line-soft bg-paper/70 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3 sm:px-10">
        <Link
          href="/"
          className="rw-monogram text-[12px] tracking-[0.32em] text-forest"
        >
          ROSEWOOD · {propertyName.replace("Rosewood ", "").toUpperCase()}
        </Link>
        <span className="text-[10px] uppercase tracking-[0.32em] text-ink-muted">
          Guest · {guestName.split(" ")[0]}
        </span>
      </div>
    </header>
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
    </>
  );
}
