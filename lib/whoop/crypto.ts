import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { whoopConfig } from "./config";

/**
 * AES-256-GCM token encryption.
 *
 * Storage format (base64-encoded):
 *   [12 bytes IV][N bytes ciphertext][16 bytes auth tag]
 *
 * GCM provides authenticated encryption — tampering with any byte of the
 * ciphertext or auth tag will cause `decryptToken` to throw, so we don't
 * need a separate MAC. We use a fresh random IV per call which is required
 * for GCM safety.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const decoded = Buffer.from(whoopConfig.tokenEncryptionKey, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `WHOOP_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). Generate with: openssl rand -base64 32`,
    );
  }
  cachedKey = decoded;
  return decoded;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

export function decryptToken(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("encrypted token blob is too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(buf.length - AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time equality check for two strings of equal length. Returns
 * false (without throwing) if lengths differ.
 */
export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
