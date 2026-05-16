import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { guests, properties } from "@/lib/db/rhythm-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/wipe
 *
 * Deletes every guest. Cascading foreign keys clear out stays, intake_answers,
 * consent_records, signals, messages, and memory_facts in the same call.
 *
 * `properties` are kept — they're the catalog, not user data.
 *
 * Intentionally not exposed in any UI button. Hit it from a shell when you
 * want a clean slate:
 *   curl -X POST http://localhost:3000/api/admin/wipe
 */
export async function POST() {
  await db.delete(guests);
  const remainingProperties = await db
    .select({ id: properties.id, slug: properties.slug })
    .from(properties);
  return NextResponse.json({
    ok: true,
    propertiesKept: remainingProperties.length,
    note: "All guests, stays, messages, intake, signals, consent records, and memory facts deleted. Properties intact.",
  });
}
