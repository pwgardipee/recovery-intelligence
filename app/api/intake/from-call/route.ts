import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  intakeAnswers,
  messages,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";
import { interpretIntake } from "@/lib/ai/prompts";

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

  // Bump scene forward so the rest of the demo continues.
  if (stay.demoScene < 3) {
    await db.update(stays).set({ demoScene: 3 }).where(eq(stays.id, stay.id));
  }

  revalidatePath(`/admin/stays/${body.stayId}`);
  revalidatePath(`/control/${body.stayId}`);
  revalidatePath(`/user/stays/${body.stayId}`);

  return NextResponse.json({
    ok: true,
    intake,
    sceneBumpedTo: Math.max(stay.demoScene, 3),
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
