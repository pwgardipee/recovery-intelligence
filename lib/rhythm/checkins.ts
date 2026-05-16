import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  consentRecords,
  guests,
  intakeAnswers,
  memoryFacts,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";
import { whoopConnections } from "@/lib/db/schema";
import {
  generateCheckin,
  generateTripWrap,
  type CheckinKind,
  type CheckinResult,
  type TripWrapResult,
} from "@/lib/ai/checkins";
import { translateWhoopSnapshotToHospitality } from "@/lib/ai/prompts";
import {
  buildTripStats,
  buildWhoopSnapshot,
  type WhoopSnapshot,
} from "@/lib/whoop/snapshot";

/**
 * Orchestrates the three on-trip / post-trip "Rose calls the guest" beats.
 *
 *   runCheckin(stayId, "morning")  → step 5 in the control panel
 *   runCheckin(stayId, "evening")  → step 6
 *   runPostStayCheckin(stayId)     → step 7
 *
 * Each one:
 *   1. Reads the Whoop snapshot (trip stats for post-stay)
 *   2. Generates a transcript + recommendation via Claude (or fallback)
 *   3. Persists messages so they render on /admin/stays/[id]:
 *        - voice_call (audio + transcript)
 *        - daily_rhythm | trip_wrap (recommendation card)
 *        - memory_write (post-stay only)
 *
 * No new tables. We piggyback on the existing message kinds where
 * possible and add ONE new kind ("trip_wrap") for the post-stay summary.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// runCheckin (morning + evening)
// ---------------------------------------------------------------------------

export async function runCheckin(
  stayId: number,
  kind: CheckinKind,
): Promise<{ ok: true; result: CheckinResult }> {
  const ctx = await stayContext(stayId);
  if (!ctx) throw new Error("stay not found");

  const whoopUserId = await resolveWhoopUserId(stayId);
  let whoopSnapshot: WhoopSnapshot | null = null;
  if (whoopUserId !== null) {
    whoopSnapshot = await buildWhoopSnapshot(whoopUserId);
  }

  const cycleComfortMode = Boolean(
    ctx.intake?.comfortFlags?.includes("cycle_comfort"),
  );
  const whoopTranslated = whoopSnapshot
    ? translateWhoopSnapshotToHospitality(whoopSnapshot, { cycleComfortMode })
    : null;

  const result = await generateCheckin({
    kind,
    guestName: ctx.guest.name.split(" ")[0],
    propertyName: ctx.property.name,
    whoopTranslated,
    whoopSnapshotForContext: whoopSnapshot,
    intakeSummary: ctx.intake?.summary ?? null,
    foodPreferences: ctx.intake?.foodPreferences ?? [],
    occasion: ctx.intake?.occasion ?? null,
  });

  // Persist the call card.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "voice_call",
    content: {
      direction: "outbound",
      to: ctx.guest.name,
      audioUrl:
        kind === "morning"
          ? "/audio/morning-checkin.mp3"
          : "/audio/evening-checkin.mp3",
      duration: estimateDurationFromTurns(result.transcript),
      label:
        kind === "morning"
          ? "Morning check-in · in-stay"
          : "Evening check-in · in-stay",
      transcript: result.transcript,
      summary: result.summary,
    },
  });

  // Persist the rhythm card. Reuses existing daily_rhythm renderer.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "daily_rhythm",
    content: {
      rhythm: {
        morningLine: result.guestLine,
        morningSubject:
          kind === "morning" ? "softer" : "balanced",
        schedule: result.staffActions.map((s, i) => ({
          timeLabel: derivedTimeLabel(kind, i),
          suggestion: s,
          optional: false,
        })),
        staffNote: result.recommendation,
        approvalRequired: false,
      },
      guestLine: result.guestLine,
      draftFor: "guest",
      dayLabel:
        kind === "morning"
          ? `Today · morning rhythm`
          : `Tonight + tomorrow · evening rhythm`,
    },
    approvalStatus: "pending",
  });

  // Bump phase to "in_stay" once a check-in fires (only forward, never
  // backward so we don't fight a manual scene jump).
  if (ctx.stay.phase !== "in_stay" && ctx.stay.phase !== "post") {
    await db
      .update(stays)
      .set({ phase: "in_stay" })
      .where(eq(stays.id, stayId));
  }

  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// runPostStayCheckin
// ---------------------------------------------------------------------------

export async function runPostStayCheckin(
  stayId: number,
): Promise<{ ok: true; result: TripWrapResult }> {
  const ctx = await stayContext(stayId);
  if (!ctx) throw new Error("stay not found");

  const whoopUserId = await resolveWhoopUserId(stayId);
  let duringTrip = emptyStats();
  let beforeTrip = emptyStats();

  if (whoopUserId !== null) {
    // Trip window: from check-in date (anchored to start of day) through
    // either checkout OR now if the guest is still mid-trip in the demo.
    const tripStart = atStartOfDay(ctx.stay.checkIn);
    const tripEnd = ctx.stay.checkOut.getTime() < Date.now()
      ? new Date(ctx.stay.checkOut.getTime())
      : new Date();
    const tripDays = Math.max(
      1,
      Math.round((tripEnd.getTime() - tripStart.getTime()) / DAY_MS),
    );
    // Baseline: SAME number of days, immediately before the stay.
    const baselineEnd = tripStart;
    const baselineStart = new Date(
      baselineEnd.getTime() - tripDays * DAY_MS,
    );

    duringTrip = await buildTripStats(whoopUserId, {
      start: tripStart,
      end: tripEnd,
    });
    beforeTrip = await buildTripStats(whoopUserId, {
      start: baselineStart,
      end: baselineEnd,
    });
  }

  const whoopSnapshot = whoopUserId
    ? await buildWhoopSnapshot(whoopUserId)
    : null;

  const result = await generateTripWrap({
    guestName: ctx.guest.name.split(" ")[0],
    propertyName: ctx.property.name,
    intakeSummary: ctx.intake?.summary ?? null,
    duringTrip: {
      avgSleepMinutes: duringTrip.avgSleepMinutes,
      avgRecoveryScore: duringTrip.avgRecoveryScore,
      workoutCount: duringTrip.workoutCount,
      workoutSports: duringTrip.workoutSports,
      avgStrain: duringTrip.avgStrain,
      daysWithData: duringTrip.daysWithData,
    },
    beforeTrip: {
      avgSleepMinutes: beforeTrip.avgSleepMinutes,
      avgRecoveryScore: beforeTrip.avgRecoveryScore,
      workoutCount: beforeTrip.workoutCount,
      workoutSports: beforeTrip.workoutSports,
      avgStrain: beforeTrip.avgStrain,
      daysWithData: beforeTrip.daysWithData,
    },
    whoopSnapshotForContext: whoopSnapshot,
  });

  // Voice call card.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "voice_call",
    content: {
      direction: "outbound",
      to: ctx.guest.name,
      audioUrl: "/audio/post-stay.mp3",
      duration: estimateDurationFromTurns(result.transcript),
      label: "Post-stay follow-up · 24h after checkout",
      transcript: result.transcript,
      summary: result.summary,
    },
  });

  // Trip wrap insight card — new message kind for the renderer.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "trip_wrap",
    content: {
      headline: result.insightHeadline,
      lines: result.insightLines,
      duringTrip: {
        avgSleepMinutes: duringTrip.avgSleepMinutes,
        avgRecoveryScore: duringTrip.avgRecoveryScore,
        workoutCount: duringTrip.workoutCount,
        workoutSports: duringTrip.workoutSports,
      },
      beforeTrip: {
        avgSleepMinutes: beforeTrip.avgSleepMinutes,
        avgRecoveryScore: beforeTrip.avgRecoveryScore,
        workoutCount: beforeTrip.workoutCount,
        workoutSports: beforeTrip.workoutSports,
      },
      guestLine: result.guestLine,
    },
  });

  // Memory write — facts to carry across properties.
  if (result.facts.length > 0) {
    await db.insert(memoryFacts).values(
      result.facts.map((f) => ({
        guestId: ctx.guest.id,
        fact: f.fact,
        kind: f.kind,
        confidence: f.confidence,
        sourceStayId: stayId,
      })),
    );
    await appendMessage(stayId, {
      thread: "staff",
      author: "rose",
      authorRole: "ai",
      kind: "memory_write",
      content: {
        headline: `Updated ${ctx.guest.name}'s profile across all Rosewood properties — ${result.facts.length} facts.`,
        facts: result.facts.map((f) => f.fact),
      },
    });
  }

  // Move stay into "closed" so the demo phase is honest.
  if (ctx.stay.phase !== "closed") {
    await db.update(stays).set({ phase: "closed" }).where(eq(stays.id, stayId));
  }

  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StayContext {
  stay: typeof stays.$inferSelect;
  guest: typeof guests.$inferSelect;
  property: typeof properties.$inferSelect;
  intake: {
    summary: string | null;
    foodPreferences: string[];
    occasion: string | null;
    comfortFlags: string[];
  } | null;
}

async function stayContext(stayId: number): Promise<StayContext | null> {
  const [row] = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);

  if (!row) return null;

  const [latestIntake] = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.stayId, stayId))
    .orderBy(desc(intakeAnswers.id))
    .limit(1);

  const answers = (latestIntake?.answers ?? null) as Record<
    string,
    unknown
  > | null;

  return {
    stay: row.stay,
    guest: row.guest,
    property: row.property,
    intake: answers
      ? {
          summary:
            typeof answers.summary === "string" ? answers.summary : null,
          foodPreferences: Array.isArray(answers.foodPreferences)
            ? (answers.foodPreferences as string[]).filter(
                (s): s is string => typeof s === "string",
              )
            : [],
          occasion:
            typeof answers.occasion === "string" ? answers.occasion : null,
          comfortFlags: Array.isArray(answers.comfortFlags)
            ? (answers.comfortFlags as string[]).filter(
                (s): s is string => typeof s === "string",
              )
            : [],
        }
      : null,
  };
}

async function resolveWhoopUserId(stayId: number): Promise<number | null> {
  // Mirrors the auto-link logic in /api/whoop/refresh-snapshot — we never
  // want a check-in to silently lose Whoop data because the consent row
  // predates the whoop_user_id column.
  const [linkedConsent] = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.stayId, stayId),
        eq(consentRecords.source, "whoop"),
        eq(consentRecords.active, true),
      ),
    )
    .orderBy(desc(consentRecords.connectedAt))
    .limit(1);
  if (linkedConsent?.whoopUserId) return linkedConsent.whoopUserId;

  const [latestConn] = await db
    .select({ whoopUserId: whoopConnections.whoopUserId })
    .from(whoopConnections)
    .where(isNull(whoopConnections.revokedAt))
    .orderBy(desc(whoopConnections.connectedAt))
    .limit(1);
  return latestConn?.whoopUserId ?? null;
}

async function appendMessage(
  stayId: number,
  msg: {
    thread: "staff" | "guest";
    author: string;
    authorRole: "ai" | "staff" | "guest";
    kind: string;
    content: Record<string, unknown>;
    approvalStatus?: "auto" | "pending" | "approved" | "declined";
  },
) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${messages.sceneOrder}), 0) + 1` })
    .from(messages)
    .where(and(eq(messages.stayId, stayId), eq(messages.thread, msg.thread)));

  await db.insert(messages).values({
    stayId,
    thread: msg.thread,
    author: msg.author,
    authorRole: msg.authorRole,
    kind: msg.kind,
    content: msg.content,
    approvalStatus: msg.approvalStatus ?? "auto",
    sceneOrder: next,
  });
}

function estimateDurationFromTurns(
  transcript: { who: string; line: string }[],
): string {
  // ~150 wpm conversational, plus ~1s of pause between turns.
  const words = transcript.reduce((n, t) => n + t.line.split(/\s+/).length, 0);
  const seconds = Math.max(20, Math.round((words / 150) * 60) + transcript.length);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function derivedTimeLabel(kind: CheckinKind, i: number): string {
  if (kind === "morning") {
    return ["8:30am", "9:30am", "11:00am", "afternoon", "evening"][i] ?? "later";
  }
  return ["this evening", "turndown", "tomorrow morning", "tomorrow midday"][i] ?? "later";
}

function emptyStats() {
  return {
    avgSleepMinutes: null as number | null,
    avgRecoveryScore: null as number | null,
    workoutCount: 0,
    workoutSports: [] as string[],
    avgStrain: null as number | null,
    daysWithData: 0,
  };
}

function atStartOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
