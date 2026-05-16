import {
  WHOOP_AUTHORIZE_URL,
  WHOOP_SCOPES,
  WHOOP_TOKEN_URL,
  whoopConfig,
} from "./config";

/**
 * OAuth 2.0 client for the WHOOP developer API.
 *
 * Authorize:  GET  /oauth/oauth2/auth   (browser)
 * Token:      POST /oauth/oauth2/token  (server)
 *
 * All POSTs use application/x-www-form-urlencoded as required by WHOOP.
 */

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope: string;
  token_type: "bearer";
}

export class WhoopOAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "WhoopOAuthError";
  }
}

export function buildAuthorizeUrl({ state }: { state: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: whoopConfig.clientId,
    redirect_uri: whoopConfig.redirectUri,
    scope: WHOOP_SCOPES.join(" "),
    state,
  });
  return `${WHOOP_AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(body: URLSearchParams): Promise<WhoopTokenResponse> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new WhoopOAuthError(
      `WHOOP token endpoint returned ${response.status}`,
      response.status,
      text,
    );
  }
  return JSON.parse(text) as WhoopTokenResponse;
}

export async function exchangeCode(
  code: string,
): Promise<WhoopTokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: whoopConfig.clientId,
      client_secret: whoopConfig.clientSecret,
      redirect_uri: whoopConfig.redirectUri,
    }),
  );
}

export async function refreshTokens(
  refreshToken: string,
): Promise<WhoopTokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: whoopConfig.clientId,
      client_secret: whoopConfig.clientSecret,
      // `offline` keeps the refresh token rolling forward.
      scope: "offline",
    }),
  );
}

/** Convert `expires_in` seconds (from a token response) to an absolute Date. */
export function expiresAtFromResponse(token: WhoopTokenResponse): Date {
  return new Date(Date.now() + token.expires_in * 1000);
}
