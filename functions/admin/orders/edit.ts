/** /admin/orders/edit — correct a customer's delivery details on an order. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc } from "../../_lib/adminHtml";
import { getOrderByRef, updateOrderCustomer } from "../../_lib/db";

const field = (label: string, name: string, value: string, extra = "") =>
  `<label style="display:block;margin-bottom:14px">${esc(label)}
    <input name="${name}" value="${esc(value)}" ${extra} style="display:block;margin-top:6px;width:100%;max-width:520px;padding:10px 12px;border:1px solid rgba(43,39,36,.25);border-radius:7px"/>
  </label>`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ref = new URL(request.url).searchParams.get("ref") || "";
  const order = ref ? await getOrderByRef(env, ref) : null;
  if (!order) {
    return htmlResponse(
      adminPage({ title: "Not found", body: `<h1>Order not found</h1><p><a href="/admin">← Back to orders</a></p>` }),
      404,
    );
  }

  const body = `
    <p><a href="/admin">← Back to orders</a></p>
    <h1>Edit delivery details</h1>
    <p class="muted">Order <strong>${esc(order.order_ref)}</strong> — fix anything the customer entered incorrectly.</p>
    <form method="post" style="margin-top:20px">
      <input type="hidden" name="ref" value="${esc(order.order_ref)}"/>
      ${field("Full name", "name", order.customer_name)}
      ${field("Phone", "phone", order.phone, 'inputmode="numeric"')}
      ${field("Email", "email", order.email, 'type="email"')}
      ${field("Delivery address", "address", order.address)}
      ${field("Pincode", "pincode", order.pincode, 'inputmode="numeric"')}
      <button type="submit">Save details</button>
    </form>`;

  return htmlResponse(adminPage({ title: "Edit order", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const ref = String(form.get("ref") ?? "");
  if (ref) {
    await updateOrderCustomer(env, ref, {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      address: String(form.get("address") ?? ""),
      pincode: String(form.get("pincode") ?? ""),
    });
  }
  return Response.redirect(
    new URL("/admin?updated=" + encodeURIComponent(ref), request.url).href,
    303,
  );
};
