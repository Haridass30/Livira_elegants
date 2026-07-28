/**
 * POST /admin/collections/upload — receive a collection cover photo
 * (client-resized, base64 JSON), store it under "__collection__" and return
 * the new image id. The old image is pruned when the new one is assigned.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { addImage } from "../../_lib/catalogDb";

const SLUG = "__collection__";
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

  const id = await addImage(env, SLUG, mime, width!, height!, bytes.buffer as ArrayBuffer);
  return json({ ok: true, id, width, height });
};
