import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";

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
 * POST /api/elevenlabs/outbound-call
 *
 * Initiates a REAL phone call via ElevenLabs' Twilio integration. The guest's
 * phone (or a number you've passed in) actually rings — Rose calls through
 * the telephone network with all the same dynamic context she gets in the
 * browser version.
 *
 * Required env:
 *   ELEVENLABS_API_KEY            — server-side ElevenLabs API key
 *   NEXT_PUBLIC_ELEVENLABS_AGENT_ID — your Rose agent id
 *   ELEVENLABS_PHONE_NUMBER_ID    — phone number id from ElevenLabs dashboard
 *                                   (imported from Twilio under Phone Numbers)
 *
 * Body: { stayId: number, toNumber?: string }
 * Returns: { conversationId, callSid }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    stayId: number;
    toNumber?: string;
  };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

  if (!apiKey || !agentId || !phoneNumberId) {
    return NextResponse.json(
      {
        error:
          "Missing ELEVENLABS_API_KEY, NEXT_PUBLIC_ELEVENLABS_AGENT_ID, or ELEVENLABS_PHONE_NUMBER_ID in .env.local",
      },
      { status: 500 },
    );
  }

  const variables = await buildDynamicVariables(body.stayId);
  const toNumber = body.toNumber ?? variables.guest_phone;

  if (!toNumber) {
    return NextResponse.json(
      { error: "No destination number — pass toNumber or set guest.phone" },
      { status: 400 },
    );
  }

  const res = await fetch(
    "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: variables,
        },
      }),
    },
  );

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error("[outbound-call] ElevenLabs returned", res.status, data);
    return NextResponse.json(
      { error: "elevenlabs_error", status: res.status, details: data },
      { status: res.status },
    );
  }

  const d = data as { conversation_id?: string; callSid?: string };
  return NextResponse.json({
    conversationId: d.conversation_id,
    callSid: d.callSid,
    toNumber,
  });
}

async function buildDynamicVariables(
  stayId: number,
): Promise<Record<string, string>> {
  const [row] = await db
    .select({ stay: stays, guest: guests, property: properties })
    .from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .innerJoin(properties, eq(properties.id, stays.propertyId))
    .where(eq(stays.id, stayId))
    .limit(1);
  if (!row) return {};

  const [intake] = await db
    .select()
    .from(intakeAnswers)
    .where(eq(intakeAnswers.stayId, stayId))
    .orderBy(asc(intakeAnswers.id))
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
      ? `${answers.flight.number}${answers.flight.origin && answers.flight.destination ? ` from ${answers.flight.origin} to ${answers.flight.destination}` : ""}${answers.flight.arrivalTime ? `, lands ${answers.flight.arrivalTime}` : ""}`
      : "(flight not yet shared)";

  const companionSummary = answers?.companion
    ? `${answers.companion.name}, her ${answers.companion.relationship}${answers.companion.note ? ` (${answers.companion.note})` : ""}`
    : "travelling solo (no companion shared)";

  const knownPreferences = memory.length
    ? memory.map((m) => `· ${m.fact}`).join("\n")
    : "(first Rosewood stay — no prior preferences on file)";

  return {
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
    intake_summary: answers?.summary || "(no intake yet)",
  };
}
