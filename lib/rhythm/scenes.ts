import { and, asc, desc, eq, sql } from "drizzle-orm";

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
import {
  extractMemory,
  generateArrivalBrief,
  generateDailyRhythm,
  interpretIntake,
  translateSignalsToHospitality,
  translateWhoopSnapshotToHospitality,
} from "@/lib/ai/prompts";
import { buildWhoopSnapshot } from "@/lib/whoop/snapshot";

/**
 * Demo scene engine.
 *
 * The demo is a deterministic series of beats. Each scene appends messages
 * to one or both threads (staff group / guest SMS), seeds data, or fires
 * an AI synthesis call. The controller increments `stays.demoScene` and
 * runs the matching scene function below.
 *
 * Order maps directly to the 3-minute live-demo script.
 */

export const SCENE_TITLES = [
  "Scene 0 — Empty: stay created, no signal yet",
  "Scene 1 — 7-day email reply (intake extracted) + identity merge",
  "Scene 2 — Guest connects health data (consent strip appears)",
  "Scene 3 — 1-day-before call (transcript + extracted prep)",
  "Scene 4 — Arrival brief generates (the wow card)",
  "Scene 5 — Day 2 morning: daily rhythm + staff approval gate",
  "Scene 6 — Approved → guest SMS lands softly",
  "Scene 7 — Delight moment proposed (anniversary)",
  "Scene 8 — Post-stay call → memory extracted",
  "Scene 9 — Six months later: Rosewood Hong Kong loads preloaded",
] as const;

export const FINAL_SCENE = SCENE_TITLES.length - 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function advanceScene(stayId: number): Promise<{
  scene: number;
  title: string;
}> {
  const stay = await getStayOrThrow(stayId);
  const next = Math.min(stay.demoScene + 1, FINAL_SCENE);
  await runScene(stayId, next);
  await db.update(stays).set({ demoScene: next }).where(eq(stays.id, stayId));
  return { scene: next, title: SCENE_TITLES[next] };
}

export async function jumpToScene(
  stayId: number,
  target: number,
): Promise<void> {
  const stay = await getStayOrThrow(stayId);
  const clamped = Math.max(0, Math.min(target, FINAL_SCENE));

  if (clamped <= stay.demoScene) {
    // Going backwards — reset and replay up to target.
    await resetStay(stayId);
    for (let s = 1; s <= clamped; s++) {
      await runScene(stayId, s);
    }
  } else {
    for (let s = stay.demoScene + 1; s <= clamped; s++) {
      await runScene(stayId, s);
    }
  }
  await db.update(stays).set({ demoScene: clamped }).where(eq(stays.id, stayId));
}

export async function resetStay(stayId: number): Promise<void> {
  await db.delete(messages).where(eq(messages.stayId, stayId));
  await db.delete(consentRecords).where(eq(consentRecords.stayId, stayId));
  await db.delete(intakeAnswers).where(eq(intakeAnswers.stayId, stayId));
  // memoryFacts persist across stays — we keep them
  await db.update(stays).set({ demoScene: 0 }).where(eq(stays.id, stayId));
}

export async function approveMessage(messageId: number): Promise<void> {
  const [m] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!m) return;

  await db
    .update(messages)
    .set({ approvalStatus: "approved" })
    .where(eq(messages.id, messageId));

  // If this was a draft of a guest message, materialize it into the guest thread.
  if (m.thread === "staff" && typeof m.content === "object" && m.content) {
    const c = m.content as Record<string, unknown>;
    if (c["draftFor"] === "guest" && typeof c["guestLine"] === "string") {
      await appendMessage(m.stayId, {
        thread: "guest",
        author: "rose",
        authorRole: "ai",
        kind: "text",
        content: { line: c["guestLine"] },
        approvalStatus: "auto",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Scene runners
// ---------------------------------------------------------------------------

async function runScene(stayId: number, scene: number): Promise<void> {
  switch (scene) {
    case 0:
      return; // empty
    case 1:
      return runScene1IntakeArrives(stayId);
    case 2:
      return runScene2HealthConnected(stayId);
    case 3:
      return runScene3PreArrivalCall(stayId);
    case 4:
      return runScene4ArrivalBrief(stayId);
    case 5:
      return runScene5DailyRhythm(stayId);
    case 6:
      return runScene6Approved(stayId);
    case 7:
      return runScene7DelightMoment(stayId);
    case 8:
      return runScene8PostStayMemory(stayId);
    case 9:
      return runScene9CrossPropertyHandoff(stayId);
  }
}

// --- Scene 1 ----------------------------------------------------------------

async function runScene1IntakeArrives(stayId: number): Promise<void> {
  const { stay, guest, property } = await fullContext(stayId);

  const transcript = `
Hi Rosewood team — thank you for the note. A few thoughts:

My flight is AA 8 from JFK landing SFO Thursday around 7:42am (red-eye).
Board dinner Friday night, so I'd love a slow Thursday evening — quiet,
no champagne, no big welcome. Light dinner in the room is perfect.
I sleep cooler than most, but please flag cycle-aware comfort if that's
an option — would mean a slightly warmer room and gentler pacing the
first two days.

Alex (my partner) is joining me Saturday — it's our anniversary, so
something quiet and thoughtful for Saturday evening would mean a lot.
Nothing announced or public.

Experiences I'd love during the stay: Asaya recovery (Friday afternoon
would be ideal), a long garden / oak grove walk, and the wine tasting if
you can move it to Saturday so Alex can join. Please don't schedule
anything intense before the Friday dinner.

Mornings can be late on Friday — anything after 9 is great. Texts > calls,
please. And the lavender scent in the room last time at Crillon was
lovely — anything like that.

Maya
`.trim();

  const intake = await interpretIntake(transcript);

  await db.insert(intakeAnswers).values({
    stayId,
    source: "email_form",
    answers: intake,
    transcript,
  });

  // Identity merge moment — staff sees we unified profiles across properties.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "identity_merge",
    content: {
      headline: `Found ${guest.mergedProfileCount} profiles for ${guest.name} across Rosewood properties — merged.`,
      properties: ["Sand Hill (current)", "Hotel de Crillon, Paris", "Rosewood Miramar Beach"],
    },
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: {
      line: `${guest.name} replied to her 7-day note. I pulled the intake — sharing the read below.`,
    },
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "intake_card",
    content: {
      vibe: intake.arrivalVibe,
      pacing: intake.pacing,
      avoid: intake.avoid,
      foodPreferences: intake.foodPreferences,
      contactPreference: intake.contactPreference,
      scent: intake.scent,
      occasion: intake.occasion,
      experiencesRequested: intake.experiencesRequested,
      flight: intake.flight,
      companion: intake.companion,
      comfortFlags: intake.comfortFlags,
      summary: intake.summary,
      propertyName: property.name,
      sourceLabel: "From the 7-day pre-arrival email reply",
      originalText: transcript,
    },
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "anya_concierge",
    authorRole: "staff",
    kind: "text",
    content: { line: "noted. she stayed at crillon in march — same lavender request then." },
  });
}

// --- Scene 2 ----------------------------------------------------------------

async function runScene2HealthConnected(stayId: number): Promise<void> {
  const { stay } = await fullContext(stayId);

  await db.insert(consentRecords).values({
    stayId,
    source: "whoop",
    autoDisconnectAt: stay.checkOut,
    notes: "Connected via pre-arrival email link.",
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "consent_strip",
    content: {
      source: "Whoop",
      connectedAt: new Date().toISOString(),
      autoDisconnectAt: stay.checkOut.toISOString(),
      use: "translated into hospitality pacing only — no metrics shared with staff",
    },
  });

  // Seed two signal snapshots — pre-arrival night and arrival-day morning.
  await db.insert(signals).values([
    {
      guestId: stay.guestId,
      source: "whoop",
      capturedAt: new Date(stay.checkIn.getTime() - 1000 * 60 * 60 * 18),
      payload: {
        sleepMinutes: 288, // 4h 48m
        sleepQuality: "fragmented",
        travelStrain: "high",
        recoveryBand: "low",
      },
    },
    {
      guestId: stay.guestId,
      source: "whoop",
      capturedAt: new Date(stay.checkIn.getTime() - 1000 * 60 * 60 * 4),
      payload: {
        sleepMinutes: 312,
        travelStrain: "high",
        recoveryBand: "low",
      },
    },
  ]);

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: {
      line: "Got her signal stream for the trip. She arrived on a short night — I'll fold that into pacing without naming it.",
    },
  });
}

// --- Scene 3 ----------------------------------------------------------------

async function runScene3PreArrivalCall(stayId: number): Promise<void> {
  const { guest } = await fullContext(stayId);

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "voice_call",
    content: {
      direction: "outbound",
      to: guest.name,
      audioUrl: "/audio/pre-arrival.mp3",
      duration: "1:14",
      transcript: [
        { who: "rose", line: "Hi Maya — this is Rose, calling on behalf of Rosewood Sand Hill ahead of tomorrow. A quick minute?" },
        { who: "maya", line: "Yeah, of course." },
        { who: "rose", line: "Lovely. I see the red-eye in at 7:42. Would you like a slower evening tomorrow, or stay open?" },
        { who: "maya", line: "Slow. Really slow. I just want to feel human before Friday." },
        { who: "rose", line: "Held. We'll keep check-in concise and put a light dinner option in your room. Any change on the wine tasting?" },
        { who: "maya", line: "Move it to Saturday if you can." },
        { who: "rose", line: "Done. One last thing — any scent that has worked before?" },
        { who: "maya", line: "Lavender. Whatever the Crillon room had." },
        { who: "rose", line: "We have it. We'll have it waiting. Travel safe." },
      ],
      summary: "Confirmed slow Thursday, wine tasting moved to Saturday, lavender scent matched to her Crillon stay.",
    },
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: { line: "Call done. Drafting arrival brief now." },
  });
}

// --- Scene 4 ----------------------------------------------------------------

async function runScene4ArrivalBrief(stayId: number): Promise<void> {
  const { stay, guest, property } = await fullContext(stayId);
  const [intake] = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.stayId, stayId))
    .orderBy(asc(intakeAnswers.id))
    .limit(1);

  const intakeAnswered: Record<string, unknown> | null = intake
    ? (intake.answers as Record<string, unknown>)
    : null;
  const cycleComfortMode = Array.isArray(intakeAnswered?.comfortFlags)
    ? (intakeAnswered.comfortFlags as string[]).includes("cycle_comfort")
    : false;

  // Prefer real Whoop data: read the stay's most recent active consent for
  // a Whoop user, snapshot the integration tables, and translate that into
  // hospitality language. Fall back to mock rw_signals only if there's no
  // connected Whoop user yet, so the demo never goes blank.
  const [whoopConsent] = await db
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

  let signalSummary: string;
  if (whoopConsent?.whoopUserId) {
    const snapshot = await buildWhoopSnapshot(whoopConsent.whoopUserId);
    if (snapshot.hasAnyData) {
      const translated = translateWhoopSnapshotToHospitality(snapshot, {
        cycleComfortMode,
      });
      signalSummary = translated.summary;
    } else {
      // Connected but the backfill hasn't returned anything yet — be honest
      // with the prompt so it doesn't invent context.
      signalSummary =
        "whoop is connected but no synced data is available yet; default to balanced pacing.";
    }
  } else {
    // Pre-Whoop fallback: legacy rw_signals payloads.
    const guestSignals = await db
      .select()
      .from(signals)
      .where(eq(signals.guestId, stay.guestId))
      .orderBy(asc(signals.capturedAt))
      .limit(5);
    signalSummary =
      guestSignals
        .map((s) =>
          translateSignalsToHospitality(s.payload as Record<string, unknown>),
        )
        .join(" ") || "no notable signals; default to balanced pacing.";
  }

  const memoryRows = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, stay.guestId))
    .limit(10);

  const brief = await generateArrivalBrief({
    guest: {
      name: guest.name,
      occasion: stay.occasion,
      mergedProfileCount: guest.mergedProfileCount,
      contactPreference: guest.contactPreference,
    },
    property: {
      name: property.name,
      city: property.city,
      senseOfPlace: property.senseOfPlace as Record<string, unknown>,
    },
    intake: (intake?.answers as never) ?? (await interpretIntake("")),
    signalSummary,
    memoryFacts: memoryRows.map((r) => ({ fact: r.fact, kind: r.kind })),
  });

  // Apply room prep automatically (these are no-mention auto-actions).
  await db
    .update(stays)
    .set({ roomTempF: brief.roomPrep.temperatureF })
    .where(eq(stays.id, stayId));

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "arrival_brief",
    content: { brief, propertyName: property.name, guestName: guest.name },
  });
}

// --- Scene 5 ----------------------------------------------------------------

async function runScene5DailyRhythm(stayId: number): Promise<void> {
  const { stay, guest, property } = await fullContext(stayId);

  // Append fresh morning signals (rough first night on property).
  await db.insert(signals).values({
    guestId: stay.guestId,
    source: "whoop",
    capturedAt: new Date(stay.checkIn.getTime() + 1000 * 60 * 60 * 14),
    payload: { sleepMinutes: 372, recoveryBand: "low", travelStrain: "moderate" },
  });

  const briefRow = await db
    .select()
    .from(messages)
    .where(and(eq(messages.stayId, stayId), eq(messages.kind, "arrival_brief")))
    .orderBy(asc(messages.id))
    .limit(1);

  const brief = briefRow[0]
    ? (briefRow[0].content as Record<string, unknown>)["brief"]
    : null;

  const daily = await generateDailyRhythm({
    property: { name: property.name, city: property.city },
    brief: brief as never,
    signalSummary:
      "short rest overnight; energy is on the lower side today — soften the morning.",
    contactPreference: guest.contactPreference,
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "daily_rhythm",
    content: {
      rhythm: daily,
      guestLine: daily.morningLine,
      draftFor: "guest",
      dayLabel: "Friday morning",
    },
    approvalStatus: "pending",
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: { line: "Drafted today's note for Maya. Approve to send." },
  });
}

// --- Scene 6 ----------------------------------------------------------------

async function runScene6Approved(stayId: number): Promise<void> {
  // Auto-approve the most recent pending daily_rhythm message and route to guest.
  const pending = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.stayId, stayId),
        eq(messages.kind, "daily_rhythm"),
        eq(messages.approvalStatus, "pending"),
      ),
    )
    .orderBy(asc(messages.id))
    .limit(1);

  if (pending[0]) {
    await approveMessage(pending[0].id);
  }

  await appendMessage(stayId, {
    thread: "staff",
    author: "philip_front",
    authorRole: "staff",
    kind: "text",
    content: { line: "approved. sent." },
  });
}

// --- Scene 7 ----------------------------------------------------------------

async function runScene7DelightMoment(stayId: number): Promise<void> {
  const { property } = await fullContext(stayId);

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "delight_moment",
    content: {
      observation:
        "Her calendar marks Saturday as an anniversary. She and her partner stayed at Crillon last year on that date.",
      proposal: `A small surprise dessert from the orchard chef on Saturday evening — handwritten note, no announcement.`,
      cost: "$0–60",
      propertyHook: `Anchored in ${property.name}'s valley orchard.`,
    },
    approvalStatus: "pending",
  });
}

// --- Scene 8 ----------------------------------------------------------------

async function runScene8PostStayMemory(stayId: number): Promise<void> {
  const { stay, guest, property } = await fullContext(stayId);

  const transcript = `
Rose: Hi Maya — this is Rose, just a quick check-in after your stay at
Rosewood Sand Hill. Two short questions, no pressure.

Maya: Sure, go ahead.

Rose: First — did the pacing feel right?

Maya: Honestly, yes. The slower Thursday made the rest of the trip work.
I would not have survived Friday otherwise. And the dessert on Saturday
was a really thoughtful touch.

Rose: I'm glad. Anything we could do differently next time?

Maya: The morning walk loop is gorgeous but the path was a little overgrown
near the bend. Otherwise, no — please remember the lavender, the late
breakfast, all of it.

Rose: We will. Thank you, Maya — safe travels home.
`.trim();

  const facts = await extractMemory(transcript, {
    propertyName: property.name,
    stayDates: `${stay.checkIn.toDateString()} – ${stay.checkOut.toDateString()}`,
  });

  if (facts.length > 0) {
    await db.insert(memoryFacts).values(
      facts.map((f) => ({
        guestId: guest.id,
        fact: f.fact,
        kind: f.kind,
        confidence: f.confidence,
        sourceStayId: stay.id,
      })),
    );
  }

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "voice_call",
    content: {
      direction: "outbound",
      to: guest.name,
      audioUrl: "/audio/post-stay.mp3",
      duration: "1:08",
      label: "Post-stay follow-up call",
      transcript: transcript
        .split("\n\n")
        .map((p) => {
          const [w, ...rest] = p.split(": ");
          return { who: w.trim().toLowerCase(), line: rest.join(": ").trim() };
        })
        .filter((t) => t.line),
      summary: "Pacing landed. Path maintenance flagged for grounds. Lavender + late breakfast confirmed as durable preferences.",
    },
  });

  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "memory_write",
    content: {
      headline: `Updated ${guest.name}'s profile for next time — across all properties.`,
      facts: facts.map((f) => f.fact),
    },
  });

  await db
    .update(stays)
    .set({ phase: "closed" })
    .where(eq(stays.id, stayId));

  // Auto-disconnect signals (visible to guest later).
  await db
    .update(consentRecords)
    .set({ active: false })
    .where(eq(consentRecords.stayId, stayId));
}

// --- Scene 9 ----------------------------------------------------------------
// Spawns the second stay (Hong Kong) WITH memory preloaded — and routes the
// admin view to that stay. The demo controller follows the link.

async function runScene9CrossPropertyHandoff(stayId: number): Promise<void> {
  const { guest } = await fullContext(stayId);

  // Find or create the Hong Kong stay.
  const [hkProp] = await db
    .select()
    .from(properties)
    .where(eq(properties.slug, "hong-kong"))
    .limit(1);
  if (!hkProp) return;

  let [hkStay] = await db
    .select()
    .from(stays)
    .where(and(eq(stays.guestId, guest.id), eq(stays.propertyId, hkProp.id)))
    .limit(1);

  if (!hkStay) {
    const checkIn = new Date();
    checkIn.setMonth(checkIn.getMonth() + 6);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 3);
    const [inserted] = await db
      .insert(stays)
      .values({
        guestId: guest.id,
        propertyId: hkProp.id,
        checkIn,
        checkOut,
        phase: "pre",
        occasion: "leisure",
        demoScene: 0,
      })
      .returning();
    hkStay = inserted;
  }

  // Reset HK stay state, then preload memory as the opening message.
  await db.delete(messages).where(eq(messages.stayId, hkStay.id));
  await db.update(stays).set({ demoScene: 0 }).where(eq(stays.id, hkStay.id));

  const memory = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, guest.id))
    .limit(12);

  await appendMessage(hkStay.id, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "preloaded_memory",
    content: {
      headline: `${guest.name} booked Rosewood Hong Kong, arriving in 6 months. Preloading her rhythm from Sand Hill.`,
      facts: memory.map((m) => m.fact),
      placeAdaptation: [
        "Sand Hill oak grove walk → Hong Kong morning Bowen Road trail",
        "Sand Hill valley honey → Hong Kong lychee honey at turndown",
        "Lavender scent retained, paired with cedar incense",
      ],
    },
  });

  await appendMessage(hkStay.id, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: { line: "Same rhythm. Different sense of place." },
  });

  // Reference the new stay back on Sand Hill so the UI can deep-link.
  await appendMessage(stayId, {
    thread: "staff",
    author: "rose",
    authorRole: "ai",
    kind: "system_event",
    content: {
      label: "Cross-property handoff",
      message: `Maya's rhythm preloaded at Rosewood Hong Kong.`,
      linkLabel: "Open Hong Kong arrival →",
      linkHref: `/admin/stays/${hkStay.id}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getStayOrThrow(stayId: number) {
  const [stay] = await db.select().from(stays).where(eq(stays.id, stayId)).limit(1);
  if (!stay) throw new Error(`stay ${stayId} not found`);
  return stay;
}

async function fullContext(stayId: number) {
  const stay = await getStayOrThrow(stayId);
  const [guest] = await db
    .select()
    .from(guests)
    .where(eq(guests.id, stay.guestId))
    .limit(1);
  const [property] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, stay.propertyId))
    .limit(1);
  if (!guest || !property) throw new Error("missing guest or property");
  return { stay, guest, property };
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
  // Determine next scene_order so the thread stays in insertion order.
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
