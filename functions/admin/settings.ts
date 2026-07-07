/**
 * /admin/settings — live store controls: enable/disable COD and online
 * payment, COD order-value cap, shipping fee & free-shipping threshold.
 * Takes effect immediately (stored in D1, enforced by /api/orders/create).
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import {
  getSettings,
  saveSettings,
  getPaymentKeys,
  setRawSetting,
  getDeployHookUrl,
} from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const saved = new URL(request.url).searchParams.get("saved");
  const [s, keys, hookUrl] = await Promise.all([
    getSettings(env),
    getPaymentKeys(env),
    getDeployHookUrl(env),
  ]);

  const check = (on: boolean) => (on ? " checked" : "");

  const body = `
    <h1>Store settings</h1>
    <p class="muted">Changes apply immediately to checkout — no redeploy needed.</p>
    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Settings saved.</div>` : ""}

    <form method="post" action="/admin/settings" style="background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:22px;max-width:640px">
      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:0 0 8px">Payment methods</h2>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin:10px 0">
        <input type="checkbox" id="cod" name="cod_enabled" value="1"${check(s.codEnabled)} style="width:18px;height:18px"/>
        <label for="cod" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:inherit">
          Cash on Delivery enabled</label>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:10px;margin:10px 0">
        <input type="checkbox" id="online" name="online_enabled" value="1"${check(s.onlineEnabled)} style="width:18px;height:18px"/>
        <label for="online" style="margin:0;text-transform:none;letter-spacing:0;font-size:14px;color:inherit">
          Online payment (Razorpay) enabled</label>
      </div>

      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:24px 0 8px">Limits &amp; shipping</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>COD max order value (₹)</label>
          <input name="cod_max_order_value" type="number" min="0" value="${esc(s.codMaxOrderValue)}"/></div>
        <div class="field"><label>Flat shipping fee (₹)</label>
          <input name="flat_shipping_fee" type="number" min="0" value="${esc(s.flatShippingFee)}"/></div>
        <div class="field"><label>Free shipping above (₹)</label>
          <input name="free_shipping_threshold" type="number" min="0" value="${esc(s.freeShippingThreshold)}"/></div>
      </div>

      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:24px 0 8px">Razorpay (online payment)</h2>
      <p class="muted" style="font-size:13px;margin:0 0 10px">
        From your Razorpay dashboard → Settings → API Keys. Use <strong>test keys</strong>
        (rzp_test_…) until you're ready to go live.
      </p>
      <div class="field"><label>Key ID</label>
        <input name="razorpay_key_id" value="${esc(keys.keyId)}" placeholder="rzp_test_…"/></div>
      <div class="field"><label>Key Secret ${keys.keySecret ? `<span style="color:#2f6b3a">(saved ✓ — leave blank to keep)</span>` : `<span style="color:#8a2f2f">(not set)</span>`}</label>
        <input name="razorpay_key_secret" type="password" value="" placeholder="${keys.keySecret ? "••••••••••••" : "paste the key secret"}" autocomplete="new-password"/></div>
      <div class="field"><label>Webhook Secret ${keys.webhookSecret ? `<span style="color:#2f6b3a">(saved ✓ — leave blank to keep)</span>` : `<span class="muted">(optional)</span>`}</label>
        <input name="razorpay_webhook_secret" type="password" value="" placeholder="${keys.webhookSecret ? "••••••••••••" : "only if you use webhooks"}" autocomplete="new-password"/></div>

      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:24px 0 8px">Publishing</h2>
      <p class="muted" style="font-size:13px;margin:0 0 10px">
        The “Publish site” button (Products page) rebuilds the shop pages using this
        Deploy Hook. Create it once in Cloudflare: Pages project → Settings → Build →
        <strong>Deploy hooks</strong> → Add → copy the URL here.
      </p>
      <div class="field"><label>Deploy Hook URL</label>
        <input name="deploy_hook_url" value="${esc(hookUrl)}" placeholder="https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/…"/></div>

      <button type="submit" style="margin-top:8px">Save settings</button>
    </form>

    <p class="muted" style="margin-top:18px;font-size:13px">
      Note: if you disable both payment methods, customers cannot check out at all.
    </p>`;

  return htmlResponse(adminPage({ title: "Settings", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const num = (name: string, fallback: number) => {
    const n = Number(form.get(name));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const current = await getSettings(env);

  await saveSettings(env, {
    codEnabled: form.get("cod_enabled") === "1",
    onlineEnabled: form.get("online_enabled") === "1",
    codMaxOrderValue: num("cod_max_order_value", current.codMaxOrderValue),
    flatShippingFee: num("flat_shipping_fee", current.flatShippingFee),
    freeShippingThreshold: num("free_shipping_threshold", current.freeShippingThreshold),
  });

  // Payment keys + deploy hook. Blank secret fields keep the stored value.
  const keyId = String(form.get("razorpay_key_id") ?? "").trim();
  await setRawSetting(env, "razorpay_key_id", keyId);
  const secret = String(form.get("razorpay_key_secret") ?? "").trim();
  if (secret) await setRawSetting(env, "razorpay_key_secret", secret);
  const webhook = String(form.get("razorpay_webhook_secret") ?? "").trim();
  if (webhook) await setRawSetting(env, "razorpay_webhook_secret", webhook);
  await setRawSetting(
    env,
    "deploy_hook_url",
    String(form.get("deploy_hook_url") ?? "").trim(),
  );

  return Response.redirect(new URL("/admin/settings?saved=1", request.url).href, 303);
};
