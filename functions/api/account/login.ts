/** POST /api/account/login — verify credentials and start a session. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { verifyPassword } from "../../_lib/crypto";
import { getAccountByEmail } from "../../_lib/accountDb";
import { createCustomerSession, customerCookieHeader } from "../../_lib/customerAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Invalid request.");
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (!email || !password) return badRequest("Enter your email and password.");

  const row = await getAccountByEmail(env, email);
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const token = await createCustomerSession(env, row.id);
  const { password_hash, ...account } = row;
  return json({ account }, 200, { "Set-Cookie": customerCookieHeader(token) });
};
