import { createHmac } from "node:crypto";

import { whoopConfig } from "./config";
import { safeEqual } from "./crypto";

/**
 * WHOOP webhook signature verification.
 *
 * Per WHOOP's docs, the expected signature is:
 *
 *   base64( HMAC_SHA256( timestamp_header + raw_body, client_secret ) )
 *
 * compared against the `X-WHOOP-Signature` header. There is also a
 * `X-WHOOP-Signature-Timestamp` header (epoch ms) used to:
 *   1. compose the signed payload, and
 *   2. enforce a replay window (we reject anything older than 5 minutes).
 *
 * Header names from WHOOP are case-insensitive on the wire; Node's headers
 * API is case-insensitive for getter calls but we still normalize.
 */

export const WHOOP_SIGNATURE_HEADER = "x-whoop-signature";
export const WHOOP_TIMESTAMP_HEADER = "x-whoop-signature-timestamp";

/** Accept timestamps within ±5 minutes of "now". */
export const WHOOP_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type VerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_signature"
        | "missing_timestamp"
        | "invalid_timestamp"
        | "stale_timestamp"
        | "signature_mismatch";
    };

export interface VerifySignatureInput {
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  /** Override "now" for testing; defaults to Date.now(). */
  now?: number;
}

export function verifySignature(
  input: VerifySignatureInput,
): VerificationResult {
  const { rawBody, signatureHeader, timestampHeader } = input;
  const now = input.now ?? Date.now();

  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!timestampHeader) return { ok: false, reason: "missing_timestamp" };

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(now - ts) > WHOOP_REPLAY_WINDOW_MS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", whoopConfig.clientSecret)
    .update(timestampHeader + rawBody, "utf8")
    .digest("base64");

  if (!safeEqual(expected, signatureHeader)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhook payload typing
// ---------------------------------------------------------------------------

export type WhoopWebhookEventType =
  | "workout.updated"
  | "workout.deleted"
  | "sleep.updated"
  | "sleep.deleted"
  | "recovery.updated"
  | "recovery.deleted";

export interface WhoopWebhookPayload {
  user_id: number;
  // For v2: UUID for sleep/workout events, integer for recovery (cycle) events
  // — but recovery in v2 uses sleep UUID. We accept string|number defensively.
  id: string | number;
  type: WhoopWebhookEventType;
  trace_id: string;
}

export function isKnownEventType(value: string): value is WhoopWebhookEventType {
  return (
    value === "workout.updated" ||
    value === "workout.deleted" ||
    value === "sleep.updated" ||
    value === "sleep.deleted" ||
    value === "recovery.updated" ||
    value === "recovery.deleted"
  );
}
