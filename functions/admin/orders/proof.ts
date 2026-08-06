/**
 * GET /admin/orders/proof?id=… — the payment screenshot a customer attached.
 *
 * Admin-only by virtue of living under /admin (see functions/admin/_middleware).
 * Never cached and never linked from the storefront: it is a customer's bank
 * app screenshot, not a public asset.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { getPaymentProof } from "../../_lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });

  const proof = await getPaymentProof(env, id);
  if (!proof) return new Response("Not found", { status: 404 });

  return new Response(proof.bytes, {
    headers: {
      "Content-Type": proof.mime,
      "Cache-Control": "private, no-store",
    },
  });
};
