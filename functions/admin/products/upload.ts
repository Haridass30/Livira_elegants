/**
 * POST /admin/products/upload — receive one client-side-resized photo as
 * base64 JSON and store it in D1. Protected by the /admin middleware.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { addImage, getProduct } from "../../_lib/catalogDb";

/** Keep uploads comfortably under D1's per-value limits. */
const MAX_BYTES = 900_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: {
    slug?: string;
    mime?: string;
    width?: number;
    height?: number;
    dataBase64?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Invalid request body.");
  }

  const { slug, mime, width, height, dataBase64 } = body;
  if (!slug || !dataBase64 || !mime?.startsWith("image/")) {
    return badRequest("Missing image data.");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height) {
    return badRequest("Missing image dimensions.");
  }

  const product = await getProduct(env, slug);
  if (!product) return badRequest("Unknown product.");

  let bytes: Uint8Array;
  try {
    const bin = atob(dataBase64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return badRequest("Invalid image encoding.");
  }
  if (bytes.byteLength > MAX_BYTES) {
    return badRequest("Image too large — please use a photo under ~900 KB.");
  }

  const id = await addImage(env, slug, mime, width!, height!, bytes.buffer as ArrayBuffer);
  return json({ ok: true, id });
};
