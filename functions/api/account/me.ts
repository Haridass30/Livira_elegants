/** GET /api/account/me — current account + its order history (or null). */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json } from "../../_lib/http";
import { getAccountById, listAccountOrders } from "../../_lib/accountDb";
import { readCustomerSession, clearCustomerCookieHeader } from "../../_lib/customerAuth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = await readCustomerSession(env, request);
  if (!id) return json({ account: null, orders: [] }, 200, { "Cache-Control": "no-store" });

  const account = await getAccountById(env, id);
  if (!account) {
    // Session points at a deleted account — clear it.
    return json({ account: null, orders: [] }, 200, {
      "Cache-Control": "no-store",
      "Set-Cookie": clearCustomerCookieHeader(),
    });
  }

  const orders = await listAccountOrders(env, account.email);
  return json({ account, orders }, 200, { "Cache-Control": "no-store" });
};
