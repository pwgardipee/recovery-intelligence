import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { whoopConnections } from "@/lib/db/schema";
import { consentRecords, stays } from "@/lib/db/rhythm-schema";
import { regenerateArrivalBrief } from "@/lib/rhythm/scenes";
import { backfill } from "@/lib/whoop/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Refresh Whoop signal" — pulls the latest 7 days of Whoop data for the
 * stay's connected user (sleep, recovery, cycle, workouts), then regenerates
 * the arrival_brief in the staff thread so any newly-imported workout or
 * recovery shows up as an updated room-prep / amenity recommendation.
 *
 * Body: { stayId: number, daysBack?: number }
 */
export async function POST(req: NextRequest) {
  let body: { stayId?: unknown; daysBack?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const stayId = Number(body.stayId);
  if (!Number.isFinite(stayId)) {
    return NextResponse.json({ error: "invalid_stayId" }, { status: 400 });
  }
  const daysBack =
    typeof body.daysBack === "number" && body.daysBack > 0 && body.daysBack <= 30
      ? Math.floor(body.daysBack)
      : 7;

  // Resolve which Whoop user this stay should pull from. Three cases:
  //   1) consent row exists for this stay AND has whoop_user_id → use it.
  //   2) consent row exists but no whoop_user_id (legacy / pre-column row) →
  //      pick the most-recently-connected unrevoked Whoop user and link it.
  //   3) no consent row at all (OAuth went through /auth/whoop/start without
  //      a stayId cookie) → pick the most-recently-connected unrevoked Whoop
  //      user, create a consent row for this stay, and link it.
  // Case 4 — no Whoop connection anywhere — is the only error.
  const [stay] = await db
    .select()
    .from(stays)
    .where(eq(stays.id, stayId))
    .limit(1);
  if (!stay) {
    return NextResponse.json({ error: "stay_not_found" }, { status: 404 });
  }

  const [consent] = await db
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

  let whoopUserId: number | null = consent?.whoopUserId ?? null;

  if (!whoopUserId) {
    const [latestConn] = await db
      .select({ whoopUserId: whoopConnections.whoopUserId })
      .from(whoopConnections)
      .where(isNull(whoopConnections.revokedAt))
      .orderBy(desc(whoopConnections.connectedAt))
      .limit(1);

    if (!latestConn) {
      return NextResponse.json(
        {
          error: "no_whoop_connection",
          message:
            "No Whoop connection found. Connect Whoop on the guest form first.",
        },
        { status: 400 },
      );
    }

    whoopUserId = latestConn.whoopUserId;

    if (consent) {
      // Backfill the missing whoop_user_id on the existing consent row.
      await db
        .update(consentRecords)
        .set({ whoopUserId })
        .where(eq(consentRecords.id, consent.id));
    } else {
      // No consent row at all — create one so future reads bypass this path.
      await db.insert(consentRecords).values({
        stayId,
        source: "whoop",
        autoDisconnectAt: stay.checkOut,
        whoopUserId,
        notes: "Auto-linked via /api/whoop/refresh-snapshot",
      });
    }
  }

  const [connection] = await db
    .select()
    .from(whoopConnections)
    .where(eq(whoopConnections.whoopUserId, whoopUserId))
    .limit(1);

  if (!connection || connection.revokedAt) {
    return NextResponse.json(
      { error: "connection_missing_or_revoked" },
      { status: 400 },
    );
  }

  // Re-sync the most recent window of data from Whoop. The brief reads from
  // the whoop_* tables, so this is what makes a just-finished workout
  // ("archery", "Barry's Bootcamp", etc.) visible in the next brief.
  try {
    await backfill(connection, daysBack);
  } catch (err) {
    console.error("[whoop:refresh-snapshot] backfill failed", err);
    return NextResponse.json(
      {
        error: "backfill_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  try {
    await regenerateArrivalBrief(stayId);
  } catch (err) {
    console.error("[whoop:refresh-snapshot] brief regen failed", err);
    return NextResponse.json(
      {
        error: "regen_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Read back the connection's lastSyncedAt so the UI can show a fresh
  // timestamp without another round-trip.
  const [post] = await db
    .select({ lastSyncedAt: whoopConnections.lastSyncedAt })
    .from(whoopConnections)
    .where(eq(whoopConnections.whoopUserId, whoopUserId))
    .limit(1);

  return NextResponse.json({
    ok: true,
    whoopUserId,
    daysBack,
    lastSyncedAt: post?.lastSyncedAt?.toISOString() ?? null,
  });
}
