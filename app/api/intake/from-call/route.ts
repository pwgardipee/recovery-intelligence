import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  intakeAnswers,
  memoryFacts,
  messages,
  properties,
  signals,
  stays,
} from "@/lib/db/rhythm-schema";
import {
  generateArrivalBrief,
  interpretIntake,
  translateSignalsToHospitality,
} from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/intake/from-call
 *
 * Accepts a real transcript (from the live ElevenLabs voice call OR the
 * "Talk to us" text chat) and converts it into structured intake. Posts the
 * call card + intake summary into the staff thread. Bumps the demo scene
 * forward so the rest of the flow continues from a real interaction.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    stayId: number;
    transcript: string;
    duration?: number;
    source?: "pre_call" | "in_app_chat";
    audioUrl?: string | null;
  };

  if (!body.stayId || !body.transcript) {
    return NextResponse.json(
      { error: "stayId and transcript required" },
      { status: 400 },
    );
  }

  const [stay] = await db
    .select()
    .from(stays)
    .where(eq(stays.id, body.stayId))
    .limit(1);
  if (!stay) return NextResponse.json({ error: "stay not found" }, { status: 404 });

  const [guest] = await db.select().from(guests).where(eq(guests.id, stay.guestId)).limit(1);
  const [property] = await db
    .select()
    .from(properties)
    .where(eq(properties.id, stay.propertyId))
    .limit(1);
  if (!guest || !property) {
    return NextResponse.json({ error: "missing relations" }, { status: 500 });
  }

  // Run Claude on the real transcript.
  const intake = await interpretIntake(body.transcript);

  // Save the intake row.
  await db.insert(intakeAnswers).values({
    stayId: body.stayId,
    source: body.source ?? "pre_call",
    answers: intake,
    transcript: body.transcript,
  });

  // Parse the transcript into structured turns for the call card.
  const turns = body.transcript
    .split(/\n+/)
    .map((line) => {
      const m = line.match(/^([A-Za-z]+):\s*(.+)$/);
      if (!m) return null;
      const who = m[1].toLowerCase().includes("rose") ? "rose" : "maya";
      return { who, line: m[2].trim() };
    })
    .filter((x): x is { who: "rose" | "maya"; line: string } => Boolean(x));

  await appendMessage(body.stayId, "staff", {
    author: "rose",
    authorRole: "ai",
    kind: "voice_call",
    content: {
      direction: "outbound",
      to: guest.name,
      audioUrl: body.audioUrl ?? "/audio/pre-arrival.mp3",
      duration: body.duration
        ? `${Math.floor(body.duration / 60)}:${(body.duration % 60).toString().padStart(2, "0")}`
        : "live",
      label: "Pre-arrival call · live",
      transcript: turns,
      summary: intake.summary,
    },
  });

  await appendMessage(body.stayId, "staff", {
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
      sourceLabel: body.source === "in_app_chat" ? "From in-app chat" : "From live pre-arrival call",
      originalText: body.transcript,
    },
  });

  // ---------------------------------------------------------------------
  // Auto-generate (or regenerate) the arrival brief.
  //
  // Step 2 (email submit) → first brief lands in the staff thread.
  // Step 3 (call ends)    → brief is replaced with a richer version that
  //                         folds in everything Rose learned on the call.
  // We replace rather than append so the thread always shows ONE
  // authoritative brief; the audience sees it appear after email and
  // refine after the call.
  // ---------------------------------------------------------------------

  await db
    .delete(messages)
    .where(
      and(
        eq(messages.stayId, body.stayId),
        eq(messages.kind, "arrival_brief"),
      ),
    );

  try {
    const guestSignals = await db
      .select()
      .from(signals)
      .where(eq(signals.guestId, stay.guestId))
      .orderBy(asc(signals.capturedAt))
      .limit(5);

    const signalSummary =
      guestSignals
        .map((s) =>
          translateSignalsToHospitality(s.payload as Record<string, unknown>),
        )
        .join(" ") || "no notable signals; default to balanced pacing.";

    const memoryRows = await db
      .select()
      .from(memoryFacts)
      .where(eq(memoryFacts.guestId, stay.guestId))
      .limit(12);

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
      intake,
      signalSummary,
      memoryFacts: memoryRows.map((r) => ({ fact: r.fact, kind: r.kind })),
    });

    await db
      .update(stays)
      .set({ roomTempF: brief.roomPrep.temperatureF })
      .where(eq(stays.id, stay.id));

    await appendMessage(body.stayId, "staff", {
      author: "rose",
      authorRole: "ai",
      kind: "arrival_brief",
      content: {
        brief,
        propertyName: property.name,
        guestName: guest.name,
        revision: body.source === "pre_call" ? "after_call" : "after_email",
      },
    });
  } catch (err) {
    console.error("[intake/from-call] brief generation failed", err);
  }

  // Bump scene forward so the rest of the demo continues.
  if (stay.demoScene < 4) {
    await db.update(stays).set({ demoScene: 4 }).where(eq(stays.id, stay.id));
  }

  revalidatePath(`/admin/stays/${body.stayId}`);
  revalidatePath(`/control/${body.stayId}`);
  revalidatePath(`/user/stays/${body.stayId}`);

  return NextResponse.json({
    ok: true,
    intake,
    sceneBumpedTo: 4,
  });
}

async function appendMessage(
  stayId: number,
  thread: "staff" | "guest",
  msg: {
    author: string;
    authorRole: "ai" | "staff" | "guest";
    kind: string;
    content: Record<string, unknown>;
  },
) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${messages.sceneOrder}), 0) + 1` })
    .from(messages)
    .where(and(eq(messages.stayId, stayId), eq(messages.thread, thread)));

  await db.insert(messages).values({
    stayId,
    thread,
    author: msg.author,
    authorRole: msg.authorRole,
    kind: msg.kind,
    content: msg.content,
    approvalStatus: "auto",
    sceneOrder: next,
  });
}
