/**
 * GET /api/content — public homepage content (announcement bar + banner slides).
 *
 * Read by the static build (src/lib/siteContent.ts) so the owner can edit the
 * banners from /admin and refresh them with the Publish button. Also read live
 * by the announcement bar as a fallback. Nothing sensitive here.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { json } from "../_lib/http";
import { getSiteContent } from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const content = await getSiteContent(env);

  // Attach each banner image's dimensions (needed for no-CLS rendering).
  const ids = [...new Set(content.slides.map((s) => s.imageId).filter((v): v is number => !!v))];
  const dims = new Map<number, { width: number; height: number }>();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id, width, height FROM product_images WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<{ id: number; width: number; height: number }>();
    for (const r of rows.results ?? []) dims.set(r.id, { width: r.width, height: r.height });
  }

  const withDims = (s: (typeof content.slides)[number]) => {
    const d = s.imageId ? dims.get(s.imageId) : undefined;
    return {
      ...s,
      imageWidth: d?.width ?? null,
      imageHeight: d?.height ?? null,
    };
  };

  const slides = content.slides.map(withDims);

  return json(
    {
      announcements: content.announcements,
      // `hero` kept for backward compatibility; `slides` is the carousel.
      hero: slides[0],
      slides,
    },
    200,
    { "Cache-Control": "no-store" },
  );
};
