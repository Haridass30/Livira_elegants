/** /admin/coupons — create, activate/deactivate and delete discount codes. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../_lib/adminHtml";
import {
  listCoupons,
  createCoupon,
  setCouponActive,
  deleteCoupon,
} from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");

  const coupons = await listCoupons(env);

  const rows =
    coupons.length === 0
      ? `<tr><td colspan="7" class="muted" style="padding:28px;text-align:center">No coupons yet — create one below.</td></tr>`
      : coupons
          .map((c) => {
            const value =
              c.type === "percent" ? `${c.value}% off` : `${money(c.value)} off`;
            const usage = `${c.used_count}${c.max_uses !== null ? ` / ${c.max_uses}` : ""}`;
            return `<tr>
          <td><strong>${esc(c.code)}</strong></td>
          <td>${value}</td>
          <td>${c.min_order > 0 ? "min " + money(c.min_order) : "—"}</td>
          <td>${c.expires_at ? esc(c.expires_at) : "never"}</td>
          <td>${usage}</td>
          <td><span class="badge ${c.active ? "s-paid" : "s-cancelled"}">${c.active ? "Active" : "Off"}</span></td>
          <td style="white-space:nowrap">
            <form method="post" action="/admin/coupons" style="display:inline">
              <input type="hidden" name="action" value="${c.active ? "deactivate" : "activate"}"/>
              <input type="hidden" name="code" value="${esc(c.code)}"/>
              <button type="submit">${c.active ? "Turn off" : "Turn on"}</button>
            </form>
            <form method="post" action="/admin/coupons" style="display:inline"
                  onsubmit="return confirm('Delete coupon ${esc(c.code)}?')">
              <input type="hidden" name="action" value="delete"/>
              <input type="hidden" name="code" value="${esc(c.code)}"/>
              <button type="submit" style="background:#8a2f2f">Delete</button>
            </form>
          </td>
        </tr>`;
          })
          .join("");

  const body = `
    <h1>Coupons</h1>
    <p class="muted">Customers enter these at checkout. Discounts are always re-checked on the server.</p>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <table>
      <thead><tr><th>Code</th><th>Discount</th><th>Min order</th><th>Expires</th><th>Used</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:36px">Create a coupon</h2>
    <form method="post" action="/admin/coupons" style="background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:20px;max-width:640px">
      <input type="hidden" name="action" value="create"/>
      <div class="field"><label>Code (e.g. WELCOME10)</label>
        <input name="code" required pattern="[A-Za-z0-9\\-]{3,24}" placeholder="WELCOME10"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>Type</label>
          <select name="type" style="width:100%;padding:10px 12px">
            <option value="percent">Percent (%)</option>
            <option value="flat">Flat (₹)</option>
          </select></div>
        <div class="field"><label>Value</label>
          <input name="value" type="number" min="1" max="100000" required placeholder="10"/></div>
        <div class="field"><label>Minimum order ₹ (0 = none)</label>
          <input name="min_order" type="number" min="0" value="0"/></div>
        <div class="field"><label>Max uses (blank = unlimited)</label>
          <input name="max_uses" type="number" min="1" placeholder=""/></div>
        <div class="field"><label>Expiry date (blank = never)</label>
          <input name="expires_at" type="date"/></div>
      </div>
      <button type="submit">Create coupon</button>
    </form>`;

  return htmlResponse(adminPage({ title: "Coupons", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const redirect = (params: string) =>
    Response.redirect(new URL(`/admin/coupons?${params}`, request.url).href, 303);

  try {
    if (action === "create") {
      const code = String(form.get("code") ?? "").trim();
      const type = form.get("type") === "flat" ? "flat" : "percent";
      const value = Number(form.get("value"));
      const minOrder = Number(form.get("min_order") ?? 0) || 0;
      const maxUsesRaw = String(form.get("max_uses") ?? "").trim();
      const expiresRaw = String(form.get("expires_at") ?? "").trim();

      if (!/^[A-Za-z0-9-]{3,24}$/.test(code))
        return redirect("err=" + encodeURIComponent("Code must be 3–24 letters/numbers."));
      if (!Number.isFinite(value) || value <= 0)
        return redirect("err=" + encodeURIComponent("Enter a valid discount value."));
      if (type === "percent" && value > 90)
        return redirect("err=" + encodeURIComponent("Percent discounts are capped at 90%."));

      await createCoupon(env, {
        code,
        type,
        value,
        minOrder,
        expiresAt: expiresRaw || null,
        maxUses: maxUsesRaw ? Math.max(1, Math.floor(Number(maxUsesRaw))) : null,
      });
      return redirect("msg=" + encodeURIComponent(`Coupon ${code.toUpperCase()} created.`));
    }

    const code = String(form.get("code") ?? "");
    if (action === "activate") await setCouponActive(env, code, true);
    else if (action === "deactivate") await setCouponActive(env, code, false);
    else if (action === "delete") await deleteCoupon(env, code);
    return redirect("msg=" + encodeURIComponent("Coupon updated."));
  } catch (e) {
    const dup = String(e).includes("UNIQUE");
    return redirect(
      "err=" +
        encodeURIComponent(dup ? "That code already exists." : "Could not save the coupon."),
    );
  }
};
