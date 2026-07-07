/**
 * GET /api/images/:id — serve a product photo from D1 with long edge caching.
 * The static build downloads these once and ships optimised copies, so this
 * endpoint mostly serves the admin UI and fresh uploads.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { getImage } from "../../_lib/catalogDb";

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Not found", { status: 404 });
  }

  // Serve from the edge cache when possible (blobs never change; deletes get
  // new ids on re-upload, so a long TTL is safe).
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const img = await getImage(env, id);
  if (!img) return new Response("Not found", { status: 404 });

  const res = new Response(img.bytes, {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  await cache.put(cacheKey, res.clone());
  return res;
};
