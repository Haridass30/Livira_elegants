/**
 * POST /admin/content/upload — receive the hero banner photo (client-resized,
 * base64 JSON), store it in D1, point the hero at it and drop the previous one.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { addImage, listImages, deleteImage } from "../../_lib/catalogDb";
import { setHeroImageId } from "../../_lib/settings";

const HERO_SLUG = "__hero__";
const MAX_BYTES = 1_400_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { mime?: string; width?: number; height?: number; dataBase64?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Invalid request body.");
  }

  const { mime, width, height, dataBase64 } = body;
  if (!dataBase64 || !mime?.startsWith("image/")) return badRequest("Missing image data.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height) {
    return badRequest("Missing image dimensions.");
  }

  let bytes: Uint8Array;
  try {
    const bin = atob(dataBase64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return badRequest("Invalid image encoding.");
  }
  if (bytes.byteLength > MAX_BYTES) {
    return badRequest("Image too large — please use a photo under ~1.4 MB.");
  }

  // Remember the old hero images so we can clean them up after switching.
  const old = await listImages(env, HERO_SLUG);

  const id = await addImage(env, HERO_SLUG, mime, width!, height!, bytes.buffer as ArrayBuffer);
  await setHeroImageId(env, id);

  // Drop previous hero photos (keep only the new one).
  for (const img of old) if (img.id !== id) await deleteImage(env, img.id);

  return json({ ok: true, id });
};
