import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  WHOOP_OAUTH_STATE_COOKIE,
  WHOOP_OAUTH_STATE_MAX_AGE_SECONDS,
} from "@/lib/whoop/config";
import { buildAuthorizeUrl } from "@/lib/whoop/oauth";

export const runtime = "nodejs";

/**
 * Entry point for the WHOOP OAuth flow.
 *
 * Generates a cryptographically random `state`, stores it in an HttpOnly
 * cookie, and 302s the user to WHOOP's authorize endpoint. The callback
 * route validates the state cookie matches the `state` query parameter to
 * defend against CSRF.
 *
 * If invoked with ?stayId=N, also stores the stay id in a sibling cookie
 * so the callback can post the consent record into the right stay and
 * advance its demo scene.
 */
export async function GET(request: NextRequest) {
  const state = randomBytes(24).toString("base64url");
  const authorizeUrl = buildAuthorizeUrl({ state });

  const url = new URL(request.url);
  const stayId = url.searchParams.get("stayId");

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(WHOOP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: WHOOP_OAUTH_STATE_MAX_AGE_SECONDS,
  });
  if (stayId && Number.isFinite(Number(stayId))) {
    response.cookies.set("rw_oauth_stay_id", stayId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: WHOOP_OAUTH_STATE_MAX_AGE_SECONDS,
    });
  }
  return response;
}
