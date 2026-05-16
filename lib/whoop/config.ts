/**
 * Centralised access to WHOOP-related environment variables and constants.
 * Throws at module import time if a required var is missing — fail-fast in
 * dev, fail-fast on Vercel cold start in production.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const WHOOP_API_HOST = "https://api.prod.whoop.com";
// REST API endpoints live under /developer; OAuth lives under /oauth.
export const WHOOP_API_BASE = `${WHOOP_API_HOST}/developer`;
export const WHOOP_AUTHORIZE_URL = `${WHOOP_API_HOST}/oauth/oauth2/auth`;
export const WHOOP_TOKEN_URL = `${WHOOP_API_HOST}/oauth/oauth2/token`;

/**
 * Cookie used to bind the OAuth `state` parameter between /auth/whoop/start
 * and /auth/whoop/callback for CSRF protection. Short-lived.
 */
export const WHOOP_OAUTH_STATE_COOKIE = "whoop_oauth_state";
export const WHOOP_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

/**
 * Scopes we request when initiating OAuth. `offline` is required to receive
 * a refresh token. The remaining scopes cover everything our concierge logic
 * needs from a guest's WHOOP account.
 */
export const WHOOP_SCOPES = [
  "offline",
  "read:profile",
  "read:body_measurement",
  "read:cycles",
  "read:recovery",
  "read:sleep",
  "read:workout",
] as const;

export const whoopConfig = {
  get clientId() {
    return required("WHOOP_CLIENT_ID");
  },
  get clientSecret() {
    return required("WHOOP_CLIENT_SECRET");
  },
  get redirectUri() {
    return required("WHOOP_REDIRECT_URI");
  },
  get tokenEncryptionKey() {
    return required("WHOOP_TOKEN_ENCRYPTION_KEY");
  },
  get appUrl() {
    return optional("APP_URL") ?? "http://localhost:3000";
  },
};
