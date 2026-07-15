/**
 * POST /admin/content/upload — receive a banner photo (client-resized, base64
 * JSON) and store it in D1. Returns the new image id; the admin page attaches
 * it to the slide being edited. Old/unused banner images are pruned when the
 * content form is saved (see functions/admin/content/index.ts).
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { addImage } from "../../_lib/catalogDb";

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

  const id = await addImage(env, HERO_SLUG, mime, width!, height!, bytes.buffer as ArrayBuffer);

  return json({ ok: true, id, width, height });
};
