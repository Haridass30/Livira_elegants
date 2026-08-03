/**
 * GET /api/config — public storefront configuration.
 *
 * Lets the checkout island reflect admin-side toggles (COD/online on-off,
 * shipping, COD cap, disabled products) without a redeploy. Contains nothing
 * sensitive; the server re-enforces all of it on order creation anyway.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { json } from "../_lib/http";
import { getSettings, getDisabledSlugs, getUpi } from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [settings, disabled, upi] = await Promise.all([
    getSettings(env),
    getDisabledSlugs(env),
    getUpi(env),
  ]);
  return json(
    {
      codEnabled: settings.codEnabled,
      onlineEnabled: settings.onlineEnabled,
      codMaxOrderValue: settings.codMaxOrderValue,
      freeShippingThreshold: settings.freeShippingThreshold,
      flatShippingFee: settings.flatShippingFee,
      disabledProducts: [...disabled],
      upi,
    },
    200,
    { "Cache-Control": "no-store" },
  );
};
