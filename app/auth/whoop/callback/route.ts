import { and, eq, sql } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { whoopConnections } from "@/lib/db/schema";
import {
  consentRecords,
  messages,
  stays,
} from "@/lib/db/rhythm-schema";
import {
  WHOOP_API_BASE,
  WHOOP_OAUTH_STATE_COOKIE,
} from "@/lib/whoop/config";
import { encryptToken } from "@/lib/whoop/crypto";
import {
  WhoopOAuthError,
  exchangeCode,
  expiresAtFromResponse,
} from "@/lib/whoop/oauth";
import { backfill } from "@/lib/whoop/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BasicProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/auth/whoop/error", request.url);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

/**
 * OAuth callback. WHOOP redirects the user here with `?code&state` after
 * approval. We:
 *   1. Validate `state` against the HttpOnly cookie set by /auth/whoop/start
 *   2. Exchange the code for tokens
 *   3. Fetch the user's basic profile (so we know their whoop_user_id)
 *   4. Upsert whoop_connections + whoop_user_profiles
 *   5. Kick off a 30-day backfill via `after()` (runs after response sent)
 *   6. Redirect to /auth/whoop/connected
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return errorRedirect(request, oauthError);
  }
  if (!code || !state) {
    return errorRedirect(request, "missing_code_or_state");
  }

  const stateCookie = request.cookies.get(WHOOP_OAUTH_STATE_COOKIE)?.value;
  if (!stateCookie || stateCookie !== state) {
    return errorRedirect(request, "state_mismatch");
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    if (err instanceof WhoopOAuthError) {
      console.error(
        "[whoop:callback] token exchange failed",
        err.status,
        err.body,
      );
    } else {
      console.error("[whoop:callback] token exchange failed", err);
    }
    return errorRedirect(request, "token_exchange_failed");
  }

  let profile: BasicProfile;
  try {
    const profileResponse = await fetch(
      `${WHOOP_API_BASE}/v2/user/profile/basic`,
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!profileResponse.ok) {
      const body = await profileResponse.text();
      throw new Error(
        `profile fetch returned ${profileResponse.status}: ${body}`,
      );
    }
    profile = (await profileResponse.json()) as BasicProfile;
  } catch (err) {
    console.error("[whoop:callback] profile fetch failed", err);
    return errorRedirect(request, "profile_fetch_failed");
  }

  const expiresAt = expiresAtFromResponse(tokens);
  const accessTokenCiphertext = encryptToken(tokens.access_token);
  const refreshTokenCiphertext = encryptToken(tokens.refresh_token);
  const scopes = tokens.scope.split(" ").filter(Boolean);

  await db
    .insert(whoopConnections)
    .values({
      whoopUserId: profile.user_id,
      accessTokenCiphertext,
      refreshTokenCiphertext,
      expiresAt,
      scopes,
      connectedAt: new Date(),
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: whoopConnections.whoopUserId,
      set: {
        accessTokenCiphertext,
        refreshTokenCiphertext,
        expiresAt,
        scopes,
        connectedAt: new Date(),
        revokedAt: null,
      },
    });

  const [connection] = await db
    .select()
    .from(whoopConnections)
    .where(eq(whoopConnections.whoopUserId, profile.user_id))
    .limit(1);

  if (connection) {
    after(async () => {
      try {
        await backfill(connection, 30);
      } catch (err) {
        console.error("[whoop:callback] backfill failed", err);
      }
    });
  }

  // If the start route stamped a stayId cookie, treat this as the guest
  // connecting their Whoop from the pre-arrival form for that specific stay.
  // Post the consent record + signal seeds + a "Whoop connected" line into
  // the staff thread, then bump the demo scene so the rest of the flow
  // continues from a real authorization.
  const stayCookie = request.cookies.get("rw_oauth_stay_id")?.value;
  const stayId = stayCookie ? Number(stayCookie) : NaN;

  let redirectUrl = new URL("/auth/whoop/connected", request.url);
  if (Number.isFinite(stayId)) {
    try {
      const [stay] = await db
        .select()
        .from(stays)
        .where(eq(stays.id, stayId))
        .limit(1);
      if (stay) {
        // Bridge: store the Whoop user_id directly so advice generation
        // (lib/whoop/snapshot.ts) can read real data for this stay without
        // any string parsing of `notes`.
        await db.insert(consentRecords).values({
          stayId,
          source: "whoop",
          autoDisconnectAt: stay.checkOut,
          whoopUserId: profile.user_id,
          notes: `Real Whoop OAuth · user_id ${profile.user_id}`,
        });

        // No mock rw_signals inserts — runScene4ArrivalBrief now reads from
        // the real whoop_* tables via buildWhoopSnapshot(). The 30-day
        // backfill above populates those tables in the background.

        // Append a consent_strip + Rose line to the staff thread.
        const [{ next }] = await db
          .select({
            next: sql<number>`coalesce(max(${messages.sceneOrder}), 0) + 1`,
          })
          .from(messages)
          .where(
            and(eq(messages.stayId, stayId), eq(messages.thread, "staff")),
          );
        await db.insert(messages).values([
          {
            stayId,
            thread: "staff",
            author: "rose",
            authorRole: "ai",
            kind: "consent_strip",
            content: {
              source: "Whoop",
              connectedAt: new Date().toISOString(),
              autoDisconnectAt: stay.checkOut.toISOString(),
              use: "translated into hospitality pacing only — no metrics shared with staff",
            },
            approvalStatus: "auto",
            sceneOrder: next,
          },
          {
            stayId,
            thread: "staff",
            author: "rose",
            authorRole: "ai",
            kind: "text",
            content: {
              line: "Got her signal stream for the trip. She arrived on a short night — I'll fold that into pacing without naming it.",
            },
            approvalStatus: "auto",
            sceneOrder: next + 1,
          },
        ]);

        if (stay.demoScene < 2) {
          await db.update(stays).set({ demoScene: 2 }).where(eq(stays.id, stayId));
        }

        redirectUrl = new URL(`/user/stays/${stayId}`, request.url);
      }
    } catch (err) {
      console.error("[whoop:callback] stay-side handoff failed", err);
    }
  }

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete(WHOOP_OAUTH_STATE_COOKIE);
  response.cookies.delete("rw_oauth_stay_id");
  return response;
}
