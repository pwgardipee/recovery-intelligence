import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  intakeAnswers,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";
import { interpretIntake } from "@/lib/ai/prompts";
import { regenerateArrivalBrief } from "@/lib/rhythm/scenes";

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

  // For pre-arrival CALLS, combine the most recent prior intake's transcript
  // with the new call transcript before re-interpreting. Otherwise a sparse
  // call ("I just want chocolate cake") would produce a sparse intake that
  // drops the email's flight, comfort flags, etc., and the brief would
  // forget context the guest already gave us.
  // For form submissions ("in_app_chat") we treat the form as the canonical
  // baseline and don't combine.
  const isCall = (body.source ?? "pre_call") === "pre_call";
  let transcriptForInterpret = body.transcript;
  if (isCall) {
    const [priorIntake] = await db
      .select()
      .from(intakeAnswers)
      .where(eq(intakeAnswers.stayId, body.stayId))
      .orderBy(desc(intakeAnswers.id))
      .limit(1);
    if (priorIntake?.transcript) {
      transcriptForInterpret = `${priorIntake.transcript}\n\n---\n\nFollow-up call transcript (just now — newer preferences here override the above):\n\n${body.transcript}`;
    }
  }

  const intake = await interpretIntake(transcriptForInterpret);

  // Save the intake row using the combined transcript so the next call can
  // build on top of it (and so the History tab shows the full context).
  await db.insert(intakeAnswers).values({
    stayId: body.stayId,
    source: body.source ?? "pre_call",
    answers: intake,
    transcript: transcriptForInterpret,
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
  //                         folds in everything Rose learned on the call
  //                         AND the latest Whoop snapshot (sleep, recent
  //                         workouts, recovery band).
  // We use the shared regenerateArrivalBrief() so this code path stays in
  // sync with /api/whoop/refresh-snapshot — both produce ONE Whoop-aware
  // brief that the audience sees appear after email and refine after call.
  // ---------------------------------------------------------------------

  try {
    await regenerateArrivalBrief(body.stayId);
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
