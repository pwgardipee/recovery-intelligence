import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  intakeAnswers,
  memoryFacts,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";
import type { IntakeAnswers } from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/context/:stayId
 *
 * Returns the dynamic variables to interpolate into the ElevenLabs agent's
 * system prompt + first message. This is how the agent "knows things" about
 * the guest before the call begins — turning a scripted survey into an
 * intelligent, personalised conversation.
 *
 * The agent in the dashboard should reference these via {{variable_name}}.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stayId = Number(id);
  if (!Number.isFinite(stayId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const [row] = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [intake] = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.stayId, stayId))
    .orderBy(desc(intakeAnswers.id))
    .limit(1);

  const memory = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, row.guest.id))
    .limit(12);

  const answers = (intake?.answers as IntakeAnswers | undefined) ?? null;

  const checkInLong = row.stay.checkIn.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const flightSummary =
    answers?.flight && answers.flight.number
      ? `${answers.flight.number}${
          answers.flight.origin && answers.flight.destination
            ? ` from ${answers.flight.origin} to ${answers.flight.destination}`
            : ""
        }${
          answers.flight.arrivalTime ? `, lands ${answers.flight.arrivalTime}` : ""
        }`
      : "(flight not yet shared)";

  const companionSummary = answers?.companion
    ? `${answers.companion.name}, her ${answers.companion.relationship}${
        answers.companion.note ? ` (${answers.companion.note})` : ""
      }`
    : "travelling solo (no companion shared)";

  const knownPreferences = memory.length
    ? memory.map((m) => `· ${m.fact}`).join("\n")
    : "(first Rosewood stay — no prior preferences on file)";

  const priorRosewoodStays = memory
    .filter((m) => m.kind === "place_affinity" || /Crillon|Sand Hill|Hong Kong|Miramar|Calistoga|Phuket|Bangkok|Amsterdam|Madrid/i.test(m.fact))
    .slice(0, 3)
    .map((m) => `· ${m.fact}`)
    .join("\n") || "(no past Rosewood stays on file)";

  const variables: Record<string, string> = {
    guest_name: row.guest.name,
    guest_first_name: row.guest.name.split(" ")[0],
    guest_phone: row.guest.phone,

    property_name: row.property.name,
    property_city: row.property.city,
    property_short: row.property.name.replace("Rosewood ", ""),
    check_in_long: checkInLong,

    flight_summary: flightSummary,
    occasion: answers?.occasion || row.stay.occasion?.replace(/_/g, " ") || "(none mentioned)",
    companion_summary: companionSummary,
    has_companion: answers?.companion ? "true" : "false",

    arrival_vibe: answers?.arrivalVibe || "(unknown)",
    pacing: answers?.pacing || "(unknown)",
    scent_preference: answers?.scent || "(unknown)",
    contact_preference: answers?.contactPreference || "sms",

    experiences_requested: answers?.experiencesRequested?.length
      ? answers.experiencesRequested.join(", ")
      : "(not yet shared)",

    comfort_flags: answers?.comfortFlags?.length
      ? answers.comfortFlags.map((f) => f.replace(/_/g, " ")).join(", ")
      : "(none flagged)",

    known_preferences: knownPreferences,
    prior_rosewood_stays: priorRosewoodStays,
    intake_summary: answers?.summary || "(no intake yet)",
  };

  return NextResponse.json({ variables });
}
