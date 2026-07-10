/**
 * GET /api/content — public homepage content (announcement bar + hero banner).
 *
 * Read by the static build (src/lib/siteContent.ts) so the owner can edit the
 * banner from /admin and refresh it with the Publish button. Also read live by
 * the announcement bar as a fallback. Nothing sensitive here.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { json } from "../_lib/http";
import { getSiteContent } from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const content = await getSiteContent(env);

  // Attach the hero image's dimensions (needed for no-CLS rendering).
  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  if (content.hero.imageId) {
    const row = await env.DB.prepare(
      `SELECT width, height FROM product_images WHERE id = ?`,
    )
      .bind(content.hero.imageId)
      .first<{ width: number; height: number }>();
    if (row) {
      imageWidth = row.width;
      imageHeight = row.height;
    }
  }

  return json(
    {
      announcements: content.announcements,
      hero: { ...content.hero, imageWidth, imageHeight },
    },
    200,
    { "Cache-Control": "no-store" },
  );
};
