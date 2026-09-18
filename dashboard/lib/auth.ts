/**
 * Minimal session gate for the dashboard.
 *
 * The dashboard proxies admin operations to the bot's control plane, so it MUST
 * not be reachable by anonymous users. This module implements a simple but
 * correctly-signed session cookie:
 *
 *   - Set DASHBOARD_PASSWORD to enable the gate (login at /login).
 *   - The session token is `<expiry>.<hmac_sha256(expiry, secret)>` and is
 *     verified with a constant-time comparison — it cannot be forged without
 *     the secret.
 *   - The signing secret falls back to CONTROL_PLANE_SECRET when
 *     DASHBOARD_SESSION_SECRET is not set.
 *
 * Uses Web Crypto (crypto.subtle) so it runs in both the Edge runtime
 * (middleware) and the Node.js runtime (route handlers).
 */

export const SESSION_COOKIE = "nl_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const encoder = new TextEncoder();

function getSigningSecret(): string {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.CONTROL_PLANE_SECRET ||
    ""
  );
}

export function isAuthEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

async function hmacHex(payload: string): Promise<string> {
  const secret = getSigningSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const expiry = Date.now() + ttlSeconds * 1000;
  const signature = await hmacHex(String(expiry));
  return `${expiry}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<boolean> {
  if (!token) return false;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return false;

  const expiryPart = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = await hmacHex(expiryPart);
  // Constant-time-ish comparison to avoid leaking prefix matches.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
