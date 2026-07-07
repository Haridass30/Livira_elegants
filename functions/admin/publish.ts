/**
 * POST /admin/publish — trigger a Cloudflare Pages rebuild via a Deploy Hook
 * so the static shop pages pick up catalogue changes (~2 minutes).
 *
 * The hook URL is created once in the Cloudflare dashboard
 * (Pages project → Settings → Build → Deploy hooks) and pasted into
 * /admin/settings. Checkout always uses live D1 data, so even without a
 * publish, pricing/stock stay correct — only the visible pages lag.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { getDeployHookUrl } from "../_lib/settings";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hook = await getDeployHookUrl(env);
  const back = (params: string) =>
    Response.redirect(new URL(`/admin/products?${params}`, request.url).href, 303);

  if (!hook) {
    return back(
      "msg=" +
        encodeURIComponent(
          "No deploy hook set. Go to Settings and paste your Deploy Hook URL (created in the Cloudflare dashboard under Pages → Settings → Build → Deploy hooks).",
        ),
    );
  }

  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) throw new Error(`hook responded ${res.status}`);
    return back(
      "msg=" +
        encodeURIComponent("Publishing… the shop pages will update in about 2 minutes."),
    );
  } catch (e) {
    console.error("[publish] hook failed", e);
    return back(
      "msg=" + encodeURIComponent("Could not start the publish — check the hook URL in Settings."),
    );
  }
};
