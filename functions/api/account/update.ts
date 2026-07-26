/** POST /api/account/update — update the signed-in customer's profile/address. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json } from "../../_lib/http";
import { getAccountById, updateAccountProfile } from "../../_lib/accountDb";
import { readCustomerSession } from "../../_lib/customerAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const id = await readCustomerSession(env, request);
  if (!id) return json({ error: "Not signed in." }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const s = (k: string) => String(body[k] ?? "");
  await updateAccountProfile(env, id, {
    name: s("name"),
    phone: s("phone"),
    street: s("street"),
    landmark: s("landmark"),
    city: s("city"),
    pincode: s("pincode"),
  });

  const account = await getAccountById(env, id);
  return json({ account }, 200, { "Cache-Control": "no-store" });
};
