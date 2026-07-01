/** GET renders the admin login form; POST checks the password + sets a session. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import {
  createSession,
  isAuthenticated,
  sessionCookieHeader,
} from "../_lib/auth";
import { safeEqual } from "../_lib/crypto";

function loginForm(error?: string): string {
  return adminPage({
    title: "Sign in",
    authed: false,
    body: `
      <form class="card" method="post" action="/admin/login">
        <h1>Livira Admin</h1>
        <p class="muted">Sign in to manage orders.</p>
        ${error ? `<div class="err">${esc(error)}</div>` : ""}
        <div class="field">
          <label for="pw">Password</label>
          <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus/>
        </div>
        <button type="submit" style="width:100%">Sign in</button>
      </form>`,
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (await isAuthenticated(request, env)) {
    return Response.redirect(new URL("/admin", request.url).toString(), 302);
  }
  return htmlResponse(loginForm());
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_PASSWORD) {
    return htmlResponse(
      loginForm("Admin is not configured. Set the ADMIN_PASSWORD secret."),
      500,
    );
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  // Constant-time-ish comparison.
  const ok =
    password.length === env.ADMIN_PASSWORD.length &&
    safeEqual(password, env.ADMIN_PASSWORD);

  if (!ok) {
    return htmlResponse(loginForm("Incorrect password."), 401);
  }

  const token = await createSession(env);
  return htmlResponse(
    `<meta http-equiv="refresh" content="0;url=/admin">`,
    303,
    {
      "Set-Cookie": sessionCookieHeader(token),
      Location: "/admin",
    },
  );
};
