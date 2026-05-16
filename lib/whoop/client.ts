import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { whoopConnections, type WhoopConnection } from "@/lib/db/schema";

import { WHOOP_API_BASE } from "./config";
import { decryptToken, encryptToken } from "./crypto";
import {
  WhoopOAuthError,
  expiresAtFromResponse,
  refreshTokens,
} from "./oauth";

/**
 * Bearer-token fetch wrapper for the WHOOP REST API.
 *
 * - Adds Authorization, Accept, no-store on every call
 * - On HTTP 401, transparently calls /oauth/oauth2/token with the refresh
 *   token, persists the new (access, refresh, expires_at) to the connection
 *   row, and retries the original request once
 * - If refresh itself fails, marks the connection `revoked_at` and throws
 *   `WhoopAuthRevokedError` so callers can stop syncing this user
 * - Logs rate-limit headers when remaining is low
 */

export class WhoopApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = "WhoopApiError";
  }
}

export class WhoopAuthRevokedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WhoopAuthRevokedError";
  }
}

interface CurrentTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

async function refreshAndStore(
  whoopUserId: number,
  currentRefreshToken: string,
): Promise<CurrentTokens> {
  const tokens = await refreshTokens(currentRefreshToken);
  const expiresAt = expiresAtFromResponse(tokens);
  await db
    .update(whoopConnections)
    .set({
      accessTokenCiphertext: encryptToken(tokens.access_token),
      refreshTokenCiphertext: encryptToken(tokens.refresh_token),
      expiresAt,
    })
    .where(eq(whoopConnections.whoopUserId, whoopUserId));
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
  };
}

async function markRevoked(whoopUserId: number): Promise<void> {
  await db
    .update(whoopConnections)
    .set({ revokedAt: new Date() })
    .where(eq(whoopConnections.whoopUserId, whoopUserId));
}

/**
 * Issue an authenticated request against the WHOOP API. Returns the raw
 * `Response` so callers can decide how to handle non-2xx (e.g. tolerate 404).
 */
export async function whoopFetch(
  connection: WhoopConnection,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (connection.revokedAt) {
    throw new WhoopAuthRevokedError(
      `WHOOP connection for user ${connection.whoopUserId} is revoked`,
    );
  }

  const url = path.startsWith("http") ? path : `${WHOOP_API_BASE}${path}`;
  let accessToken = decryptToken(connection.accessTokenCiphertext);

  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

  let response = await send(accessToken);

  if (response.status === 401) {
    try {
      const refreshed = await refreshAndStore(
        connection.whoopUserId,
        decryptToken(connection.refreshTokenCiphertext),
      );
      accessToken = refreshed.accessToken;
    } catch (cause) {
      if (cause instanceof WhoopOAuthError && cause.status >= 400) {
        await markRevoked(connection.whoopUserId);
        throw new WhoopAuthRevokedError(
          `WHOOP refresh failed for user ${connection.whoopUserId}; user must re-authorize`,
          { cause },
        );
      }
      throw cause;
    }
    response = await send(accessToken);
  }

  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  if (remainingHeader) {
    const remaining = Number.parseInt(remainingHeader, 10);
    if (Number.isFinite(remaining) && remaining < 10) {
      console.warn(
        `[whoop] low rate limit: ${remaining} remaining for user ${connection.whoopUserId}`,
      );
    }
  }

  return response;
}

/**
 * GET a JSON resource. Throws WhoopApiError on non-2xx unless the status
 * is in `tolerate` (in which case the function returns null).
 */
export async function whoopGetJson<T>(
  connection: WhoopConnection,
  path: string,
  options: { tolerate?: number[] } = {},
): Promise<T | null> {
  const response = await whoopFetch(connection, path, { method: "GET" });
  if (options.tolerate?.includes(response.status)) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new WhoopApiError(
      `WHOOP API ${response.status} for GET ${path}`,
      response.status,
      body,
    );
  }
  return (await response.json()) as T;
}
