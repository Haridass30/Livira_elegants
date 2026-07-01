/**
 * Minimal signed-cookie session for the /admin area.
 *
 * A session token is `<payloadB64>.<hmacHex>` where the payload holds an expiry.
 * The HMAC is keyed with ADMIN_SESSION_SECRET, so the cookie can't be forged.
 * No database session table needed.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";
import { hmacSha256Hex, safeEqual } from "./crypto";

const COOKIE_NAME = "livira_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/** Create a signed session token valid for SESSION_TTL_MS. */
export async function createSession(env: Env): Promise<string> {
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "";
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSha256Hex(payload, secret);
  return `${payload}.${sig}`;
}

/** True if the token is well-formed, correctly signed and unexpired. */
export async function isValidSession(env: Env, token?: string | null): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "";
  if (!secret) return false;
  const [payload, sig] = token.split(".");
  const expected = await hmacSha256Hex(payload, secret);
  if (!safeEqual(expected, sig)) return false;
  try {
    const { exp } = JSON.parse(unb64url(payload)) as { exp: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

/** Read the raw session cookie value from a request. */
export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Convenience: is the current request authenticated? */
export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  return isValidSession(env, readSessionCookie(request));
}

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
