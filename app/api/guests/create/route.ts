import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  memoryFacts,
  properties,
  stays,
} from "@/lib/db/rhythm-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/guests/create
 *
 * Spawn a fresh demo guest with a name the presenter picks. Pre-seeds a
 * small portfolio of cross-property memory facts so Step 1 (Recognize the
 * guest) is impactful — there's something real to "carry forward."
 *
 * Body: {
 *   name: string,
 *   phone?: string,        // E.164, defaults to a sentinel
 *   returning?: boolean,   // default true — seed prior-stay memory
 *   propertySlug?: string, // default "sand-hill"
 * }
 *
 * Returns: { stayId, guestId }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name: string;
    phone?: string;
    returning?: boolean;
    propertySlug?: string;
  };

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const name = body.name.trim();
  const firstName = name.split(/\s+/)[0];
  const returning = body.returning !== false;
  const propertySlug = body.propertySlug ?? "sand-hill";

  // Find the target property.
  const [property] = await db
    .select()
    .from(properties)
    .where(eq(properties.slug, propertySlug))
    .limit(1);
  if (!property) {
    return NextResponse.json(
      { error: `property "${propertySlug}" not seeded — POST /api/seed first` },
      { status: 400 },
    );
  }

  // Build an email from the name.
  const emailSlug = name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  const email = `${emailSlug}+demo@example.com`;

  // Create the guest record.
  const [guest] = await db
    .insert(guests)
    .values({
      name,
      email,
      phone: body.phone?.trim() || "+1 415 555 0182",
      photoUrl: null,
      contactPreference: "sms",
      mergedProfileCount: returning ? 3 : 1,
    })
    .returning();

  // Seed cross-property memory if this is a "returning" guest. These are
  // intentionally generic so they work for any name — the source-property
  // tags + Rose's voice make them feel specific.
  if (returning) {
    await db.insert(memoryFacts).values([
      {
        guestId: guest.id,
        fact: `Prefers a quiet first evening after long travel.`,
        kind: "preference",
        confidence: 0.92,
      },
      {
        guestId: guest.id,
        fact: `Late breakfast (after 9am) on travel-recovery mornings.`,
        kind: "pattern",
        confidence: 0.9,
      },
      {
        guestId: guest.id,
        fact: `Loves the lavender scent from Hotel de Crillon (Mar 2025).`,
        kind: "preference",
        confidence: 0.93,
      },
      {
        guestId: guest.id,
        fact: `Responds well to low-touch check-in; no amenity tour.`,
        kind: "preference",
        confidence: 0.88,
      },
    ]);
  }

  // Create a stay starting tomorrow, 3 nights.
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 1);
  checkIn.setHours(15, 0, 0, 0);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 3);

  const [stay] = await db
    .insert(stays)
    .values({
      guestId: guest.id,
      propertyId: property.id,
      checkIn,
      checkOut,
      phase: "pre",
      roomNumber: "Garden Suite",
      occasion: null,
      demoScene: 0,
    })
    .returning();

  return NextResponse.json({
    ok: true,
    stayId: stay.id,
    guestId: guest.id,
    guestName: name,
    firstName,
  });
}
