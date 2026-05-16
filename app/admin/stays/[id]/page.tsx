import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  consentRecords,
  guests,
  memoryFacts,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";

import { StaffThread } from "./message-renderer";

export const dynamic = "force-dynamic";

export default async function AdminStayPage({
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

  const allMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.stayId, stayId))
    .orderBy(asc(messages.thread), asc(messages.sceneOrder));

  const staffMessages = allMessages
    .filter((m) => m.thread === "staff")
    .map(serializeMessage);

  const [activeConsent] = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.stayId, stayId))
    .limit(1);

  const memory = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, row.guest.id))
    .limit(10);

  return (
    <main className="flex min-h-screen flex-col bg-ivory">
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
            <Link
              href={`/control/${stayId}`}
              className="rounded-sm border border-line bg-paper px-3 py-1 text-[10.5px] uppercase tracking-[0.2em] text-ink-soft hover:text-forest"
            >
              Open control →
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1100px] flex-1">
        <StaffThread messages={staffMessages} />
      </section>
    </main>
  );
}

function formatRange(a: Date, b: Date) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} → ${b.toLocaleDateString("en-US", opts)}`;
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

function serializeMessage(m: typeof messages.$inferSelect) {
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
