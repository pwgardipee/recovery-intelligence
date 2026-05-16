import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

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
 */
export async function GET() {
  const state = randomBytes(24).toString("base64url");
  const authorizeUrl = buildAuthorizeUrl({ state });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(WHOOP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: WHOOP_OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
