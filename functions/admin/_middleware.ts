/**
 * Route guard for everything under /admin, EXCEPT the login/logout endpoints.
 * Unauthenticated requests are redirected to the login page.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { isAuthenticated } from "../_lib/auth";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/\/$/, "");

  // Public admin routes.
  if (path === "/admin/login" || path === "/admin/logout") {
    return ctx.next();
  }

  if (await isAuthenticated(ctx.request, ctx.env)) {
    return ctx.next();
  }

  return Response.redirect(new URL("/admin/login", url).toString(), 302);
};
