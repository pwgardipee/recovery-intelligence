import { eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { whoopConnections, whoopWebhookEvents } from "@/lib/db/schema";
import { WhoopAuthRevokedError } from "@/lib/whoop/client";
import {
  markRecoveryDeletedBySleepId,
  markSleepDeleted,
  markWorkoutDeleted,
  syncRecoveryBySleepId,
  syncSleep,
  syncWorkout,
} from "@/lib/whoop/sync";
import {
  WHOOP_SIGNATURE_HEADER,
  WHOOP_TIMESTAMP_HEADER,
  type WhoopWebhookPayload,
  isKnownEventType,
  verifySignature,
} from "@/lib/whoop/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHOOP webhook receiver.
 *
 * WHOOP retries failed deliveries 5 times over 1 hour with exponential
 * backoff, so we must:
 *   - Respond fast (target <500ms). We ACK 200 immediately and use `after()`
 *     to fetch + upsert the resource asynchronously.
 *   - Be idempotent. The `whoop_webhook_events` table has a unique index on
 *     `trace_id`; conflicts short-circuit to 200 OK.
 *   - Reject unsigned requests. HMAC verification happens before we read the
 *     payload as JSON.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const verification = verifySignature({
    rawBody,
    signatureHeader: request.headers.get(WHOOP_SIGNATURE_HEADER),
    timestampHeader: request.headers.get(WHOOP_TIMESTAMP_HEADER),
  });

  if (!verification.ok) {
    console.warn(
      `[whoop:webhook] rejected signature: ${verification.reason}`,
    );
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: WhoopWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhoopWebhookPayload;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (
    typeof payload.user_id !== "number" ||
    !payload.type ||
    !payload.trace_id ||
    payload.id === undefined ||
    payload.id === null
  ) {
    return new NextResponse("malformed payload", { status: 400 });
  }

  // Insert event row. ON CONFLICT (trace_id) DO NOTHING serves as our
  // idempotency check — drizzle returns the inserted row count via the
  // `returning()` shape; we use the empty array to detect conflict.
  const inserted = await db
    .insert(whoopWebhookEvents)
    .values({
      traceId: payload.trace_id,
      type: payload.type,
      whoopUserId: payload.user_id,
      resourceId: String(payload.id),
      payload,
    })
    .onConflictDoNothing({ target: whoopWebhookEvents.traceId })
    .returning({ id: whoopWebhookEvents.id });

  if (inserted.length === 0) {
    // Already received this trace_id — ACK without re-processing.
    return new NextResponse("ok (duplicate)", { status: 200 });
  }

  const eventRowId = inserted[0].id;

  after(async () => {
    try {
      await processWebhookEvent(payload);
      await db
        .update(whoopWebhookEvents)
        .set({ processedAt: new Date(), processingError: null })
        .where(eq(whoopWebhookEvents.id, eventRowId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[whoop:webhook] processing failed for trace ${payload.trace_id}:`,
        err,
      );
      await db
        .update(whoopWebhookEvents)
        .set({ processingError: message })
        .where(eq(whoopWebhookEvents.id, eventRowId));
    }
  });

  return new NextResponse("ok", { status: 200 });
}

async function processWebhookEvent(
  payload: WhoopWebhookPayload,
): Promise<void> {
  if (!isKnownEventType(payload.type)) {
    console.warn(`[whoop:webhook] unknown event type: ${payload.type}`);
    return;
  }

  const resourceId = String(payload.id);

  // Deletes don't need an authenticated API call — flip deleted_at locally.
  if (payload.type === "workout.deleted") {
    await markWorkoutDeleted(resourceId);
    return;
  }
  if (payload.type === "sleep.deleted") {
    await markSleepDeleted(resourceId);
    return;
  }
  if (payload.type === "recovery.deleted") {
    // v2: recovery webhook id is the SLEEP UUID
    await markRecoveryDeletedBySleepId(resourceId);
    return;
  }

  // For *.updated we need the user's access token to fetch the resource.
  const [connection] = await db
    .select()
    .from(whoopConnections)
    .where(eq(whoopConnections.whoopUserId, payload.user_id))
    .limit(1);

  if (!connection) {
    console.warn(
      `[whoop:webhook] no connection for whoop_user_id=${payload.user_id}; ignoring ${payload.type}`,
    );
    return;
  }
  if (connection.revokedAt) {
    console.warn(
      `[whoop:webhook] connection revoked for whoop_user_id=${payload.user_id}; ignoring ${payload.type}`,
    );
    return;
  }

  try {
    if (payload.type === "workout.updated") {
      await syncWorkout(connection, resourceId);
    } else if (payload.type === "sleep.updated") {
      await syncSleep(connection, resourceId);
    } else if (payload.type === "recovery.updated") {
      // v2: id is the sleep UUID. syncRecoveryBySleepId fetches the sleep,
      // reads its cycle_id, then fetches the recovery for that cycle.
      await syncRecoveryBySleepId(connection, resourceId);
    }
  } catch (err) {
    if (err instanceof WhoopAuthRevokedError) {
      // Connection was already marked revoked inside the client; nothing to do.
      console.warn(
        `[whoop:webhook] connection revoked while processing ${payload.type}`,
      );
      return;
    }
    throw err;
  }
}
