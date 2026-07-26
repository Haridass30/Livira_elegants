/**
 * Signed-cookie session for customer accounts (separate from the /admin one).
 * Token = `<payloadB64>.<hmacHex>` where the payload holds the account id + exp.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";
import { hmacSha256Hex, safeEqual } from "./crypto";

const COOKIE_NAME = "livira_customer";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(env: Env): string {
  return (
    (env as unknown as { CUSTOMER_SESSION_SECRET?: string }).CUSTOMER_SESSION_SECRET ||
    env.ADMIN_SESSION_SECRET ||
    env.ADMIN_PASSWORD ||
    "livira-customer-fallback"
  );
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export async function createCustomerSession(env: Env, accountId: number): Promise<string> {
  const payload = b64url(JSON.stringify({ sub: accountId, exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSha256Hex(payload, secret(env));
  return `${payload}.${sig}`;
}

/** Returns the signed-in account id, or null. */
export async function readCustomerSession(env: Env, request: Request): Promise<number | null> {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = m ? decodeURIComponent(m[1]) : null;
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = await hmacSha256Hex(payload, secret(env));
  if (!safeEqual(expected, sig)) return null;
  try {
    const { sub, exp } = JSON.parse(unb64url(payload)) as { sub: number; exp: number };
    return typeof exp === "number" && exp > Date.now() ? Number(sub) : null;
  } catch {
    return null;
  }
}

export function customerCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCustomerCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
