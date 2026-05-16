import { config } from "dotenv";
config({ path: ".env.local" });

import { createHmac } from "node:crypto";

import { encryptToken, decryptToken } from "../lib/whoop/crypto.ts";
import { verifySignature } from "../lib/whoop/webhook.ts";
import { buildAuthorizeUrl } from "../lib/whoop/oauth.ts";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${extra ? "  " + extra : ""}`);
  }
};

const plain =
  "whoop_access_token_test_value_with_special_chars_!@#$%^&*()";
const encrypted = encryptToken(plain);
ok("crypto round-trip", decryptToken(encrypted) === plain);

let detected = false;
try {
  decryptToken(encrypted.slice(0, -2) + "XX");
} catch {
  detected = true;
}
ok("crypto tamper detection", detected);

const secret = process.env.WHOOP_CLIENT_SECRET || "test-secret";
process.env.WHOOP_CLIENT_SECRET = secret;
const body = JSON.stringify({
  user_id: 12345,
  id: "sleep-uuid-abc",
  type: "sleep.updated",
  trace_id: "trace-xyz",
});
const ts = String(Date.now());
const sig = createHmac("sha256", secret)
  .update(ts + body, "utf8")
  .digest("base64");
const result = verifySignature({
  rawBody: body,
  signatureHeader: sig,
  timestampHeader: ts,
});
ok("webhook signature accepted", result.ok);

const stale = String(Date.now() - 10 * 60 * 1000);
const staleSig = createHmac("sha256", secret)
  .update(stale + body, "utf8")
  .digest("base64");
const staleResult = verifySignature({
  rawBody: body,
  signatureHeader: staleSig,
  timestampHeader: stale,
});
ok(
  "webhook stale-timestamp rejection",
  !staleResult.ok && staleResult.reason === "stale_timestamp",
);

const tamperedSigResult = verifySignature({
  rawBody: body + " ",
  signatureHeader: sig,
  timestampHeader: ts,
});
ok(
  "webhook tampered-body rejection",
  !tamperedSigResult.ok && tamperedSigResult.reason === "signature_mismatch",
);

process.env.WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID || "placeholder";
process.env.WHOOP_REDIRECT_URI =
  process.env.WHOOP_REDIRECT_URI || "http://localhost:3000/auth/whoop/callback";
const authUrl = new URL(buildAuthorizeUrl({ state: "test-state-123" }));
ok(
  "authorize URL host",
  authUrl.host === "api.prod.whoop.com" &&
    authUrl.pathname === "/oauth/oauth2/auth",
);
ok(
  "authorize URL has required params",
  authUrl.searchParams.get("response_type") === "code" &&
    authUrl.searchParams.get("state") === "test-state-123" &&
    authUrl.searchParams.get("scope")?.includes("offline") === true &&
    authUrl.searchParams.get("scope")?.includes("read:sleep") === true,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
