/** POST /api/account/register — create a customer account and sign them in. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { hashPassword } from "../../_lib/crypto";
import { createAccount, getAccountByEmail, getAccountById } from "../../_lib/accountDb";
import { createCustomerSession, customerCookieHeader } from "../../_lib/customerAuth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Invalid request.");
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if (!EMAIL_RE.test(email)) return badRequest("Please enter a valid email address.");
  if (password.length < 6) return badRequest("Password must be at least 6 characters.");
  if (name.length < 2) return badRequest("Please enter your name.");

  if (await getAccountByEmail(env, email))
    return badRequest("An account with this email already exists. Please sign in.");

  const passwordHash = await hashPassword(password);
  const id = await createAccount(env, { email, passwordHash, name });
  const token = await createCustomerSession(env, id);
  const account = await getAccountById(env, id);

  return json({ account }, 200, { "Set-Cookie": customerCookieHeader(token) });
};
