/** POST /api/account/logout — clear the customer session cookie. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json } from "../../_lib/http";
import { clearCustomerCookieHeader } from "../../_lib/customerAuth";

export const onRequestPost: PagesFunction<Env> = async () =>
  json({ ok: true }, 200, { "Set-Cookie": clearCustomerCookieHeader() });
