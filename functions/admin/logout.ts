/** Clears the admin session cookie and returns to the login page. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { clearCookieHeader } from "../_lib/auth";

const bye = (request: Request) =>
  new Response(null, {
    status: 303,
    headers: {
      "Set-Cookie": clearCookieHeader(),
      Location: new URL("/admin/login", request.url).toString(),
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request }) => bye(request);
export const onRequestGet: PagesFunction<Env> = async ({ request }) => bye(request);
