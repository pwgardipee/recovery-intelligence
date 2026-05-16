import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  memoryFacts,
  messages,
  properties,
  signals,
  stays,
} from "@/lib/db/rhythm-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/seed
 *
 * Idempotent seed of the demo dataset. Creates the two properties
 * (Sand Hill + Hong Kong), the demo guest (Maya), a stay at Sand Hill
 * starting tonight, and a small memory residue from a prior stay so the
 * "we know this guest" beat lands instantly.
 *
 * Safe to call multiple times — re-running wipes per-stay state but keeps
 * the same primary keys.
 */
export async function POST() {
  // ---- Properties --------------------------------------------------------

  const sandHillSenseOfPlace = {
    palette: ["ivory", "moss", "valley honey"],
    scentSignature: "cedar & wildflower; lavender bundle on request",
    soundtrack: "soft acoustic strings, low volume",
    welcomeAmenityIdeas: [
      "valley honey & chamomile",
      "stone-fruit galette from the orchard",
      "magnesium tea service",
      "eucalyptus shower bundle",
    ],
    ritualPairings: [
      "oak grove walk (15-min loop)",
      "still water of the koi garden",
      "Asaya restorative treatment",
    ],
    movementOptions: [
      "morning loop through the oak grove",
      "yoga on the lawn at 7am",
      "gentle hike to the Sand Hill ridge",
    ],
    diningSignatures: [
      "farm-to-table tasting menu",
      "garden table dinner",
      "in-room slow service",
    ],
    heroQuote: "A quiet valley, on your pace.",
  };

  const hkSenseOfPlace = {
    palette: ["jade", "tea-rose", "ink"],
    scentSignature: "cedar incense, lychee, white tea",
    soundtrack: "guqin & soft electronic",
    welcomeAmenityIdeas: [
      "lychee honey at turndown",
      "Hong Kong egg tart from the dawn pastry table",
      "white tea ritual",
    ],
    ritualPairings: [
      "Bowen Road morning trail",
      "Asaya rooftop garden",
      "harbour view stillness",
    ],
    movementOptions: [
      "Bowen Road trail (gentle)",
      "rooftop yoga at sunrise",
      "Victoria Peak meditation walk",
    ],
    diningSignatures: [
      "dim sum at sunrise on the terrace",
      "private chef's table at The Legacy House",
      "in-room slow service",
    ],
    heroQuote: "Stillness above the harbour.",
  };

  await db
    .insert(properties)
    .values([
      {
        slug: "sand-hill",
        name: "Rosewood Sand Hill",
        city: "Menlo Park",
        country: "United States",
        senseOfPlace: sandHillSenseOfPlace,
      },
      {
        slug: "hong-kong",
        name: "Rosewood Hong Kong",
        city: "Hong Kong",
        country: "Hong Kong SAR",
        senseOfPlace: hkSenseOfPlace,
      },
    ])
    .onConflictDoNothing();

  const [sandHill] = await db
    .select()
    .from(properties)
    .where(eq(properties.slug, "sand-hill"))
    .limit(1);
  const [hongKong] = await db
    .select()
    .from(properties)
    .where(eq(properties.slug, "hong-kong"))
    .limit(1);

  if (!sandHill || !hongKong) {
    return NextResponse.json({ error: "property insert failed" }, { status: 500 });
  }

  // ---- Guest -------------------------------------------------------------

  await db
    .insert(guests)
    .values({
      name: "Maya Chen",
      email: "maya@maya-ventures.com",
      phone: "+1 415 555 0182",
      photoUrl: null,
      contactPreference: "sms",
      mergedProfileCount: 3,
    })
    .onConflictDoNothing();

  let [maya] = await db
    .select()
    .from(guests)
    .where(eq(guests.email, "maya@maya-ventures.com"))
    .limit(1);

  if (!maya) {
    return NextResponse.json({ error: "guest insert failed" }, { status: 500 });
  }

  // ---- Pre-existing memory (from her Crillon stay last year) --------------

  const existingMemory = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, maya.id))
    .limit(1);

  if (existingMemory.length === 0) {
    await db.insert(memoryFacts).values([
      {
        guestId: maya.id,
        fact: "Loves the lavender scent from her Hotel de Crillon room (March 2025).",
        kind: "preference",
        confidence: 0.95,
      },
      {
        guestId: maya.id,
        fact: "Travels frequently for board meetings; arrives in fragile state, needs slow first night.",
        kind: "pattern",
        confidence: 0.9,
      },
    ]);
  }

  // ---- Sand Hill stay (current) -------------------------------------------

  const now = new Date();
  const checkIn = new Date(now);
  checkIn.setHours(checkIn.getHours() + 24);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 3);

  let [sandStay] = await db
    .select()
    .from(stays)
    .where(eq(stays.guestId, maya.id));

  if (!sandStay) {
    const [inserted] = await db
      .insert(stays)
      .values({
        guestId: maya.id,
        propertyId: sandHill.id,
        checkIn,
        checkOut,
        phase: "pre",
        roomNumber: "Garden Suite 14",
        occasion: "board_dinner_friday",
        demoScene: 0,
      })
      .returning();
    sandStay = inserted;
  } else {
    // Wipe demo-generated content but keep the stay row.
    await db.delete(messages).where(eq(messages.stayId, sandStay.id));
    await db.delete(signals).where(eq(signals.guestId, maya.id));
    await db
      .update(stays)
      .set({ demoScene: 0, phase: "pre", checkIn, checkOut })
      .where(eq(stays.id, sandStay.id));
  }

  return NextResponse.json({
    ok: true,
    sandHillStayId: sandStay.id,
    guest: maya.name,
    properties: { sandHill: sandHill.id, hongKong: hongKong.id },
    nextSteps: [
      `Open /admin/stays/${sandStay.id} to start the demo`,
      `Or visit /stay/${sandStay.id}/connect to see the guest-facing pre-arrival screen`,
    ],
  });
}

export async function GET() {
  return NextResponse.json({
    info: "POST to this endpoint to seed the demo dataset.",
  });
}
