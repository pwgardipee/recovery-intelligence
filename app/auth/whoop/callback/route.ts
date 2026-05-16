import { eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { whoopConnections } from "@/lib/db/schema";
import {
  WHOOP_API_BASE,
  WHOOP_OAUTH_STATE_COOKIE,
  whoopConfig,
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

  const redirectUrl = new URL("/auth/whoop/connected", request.url);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete(WHOOP_OAUTH_STATE_COOKIE);
  return response;
}
