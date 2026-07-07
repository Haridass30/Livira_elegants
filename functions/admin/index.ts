/** Admin dashboard: headline stats + recent orders with inline status updates. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../_lib/adminHtml";
import { getStats, listOrders } from "../_lib/db";
import type { PricedLine } from "../../src/lib/types";

const STATUSES = [
  "pending",
  "paid",
  "cod_pending",
  "shipped",
  "delivered",
  "cancelled",
  "failed",
];

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["paid", "Paid"],
  ["cod_pending", "COD pending"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];

function fmtDate(s: string): string {
  // Stored as UTC "YYYY-MM-DD HH:MM:SS".
  const [d, t = ""] = s.split(" ");
  return `${d}<br><span class="muted" style="font-size:11px">${t.slice(0, 5)} UTC</span>`;
}

function itemsCell(json: string): string {
  let lines: PricedLine[] = [];
  try {
    lines = JSON.parse(json) as PricedLine[];
  } catch {
    /* ignore */
  }
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const list = lines
    .map((l) => `<li>${esc(l.name)} × ${l.qty} — ${money(l.lineTotal)}</li>`)
    .join("");
  return `<details><summary>${count} item${count === 1 ? "" : "s"}</summary><ul class="items">${list}</ul></details>`;
}

function statusForm(orderRef: string, current: string, filter: string): string {
  const opts = STATUSES.map(
    (s) =>
      `<option value="${s}"${s === current ? " selected" : ""}>${s.replace("_", " ")}</option>`,
  ).join("");
  return `<form method="post" action="/admin/orders/update" style="display:flex;gap:6px;align-items:center">
    <input type="hidden" name="order_ref" value="${esc(orderRef)}"/>
    <input type="hidden" name="filter" value="${esc(filter)}"/>
    <select name="status" aria-label="Order status">${opts}</select>
    <button type="submit">Save</button>
  </form>`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") || "all";
  const updated = url.searchParams.get("updated");

  const [stats, orders] = await Promise.all([
    getStats(env),
    listOrders(env, filter, 200),
  ]);

  const statCards = `
    <div class="stats">
      <div class="stat"><div class="label">Revenue (paid + delivered)</div><div class="value">${money(stats.revenue)}</div></div>
      <div class="stat"><div class="label">COD to collect</div><div class="value">${money(stats.codOutstanding)}</div></div>
      <div class="stat"><div class="label">Total orders</div><div class="value">${stats.totalOrders}</div></div>
      <div class="stat"><div class="label">Paid online</div><div class="value">${stats.paidCount}</div></div>
      <div class="stat"><div class="label">COD pending</div><div class="value">${stats.codPendingCount}</div></div>
    </div>`;

  const filterTabs = `<div class="filters">${FILTERS.map(
    ([v, label]) =>
      `<a href="/admin?status=${v}" class="${filter === v ? "active" : ""}">${label}</a>`,
  ).join("")}</div>`;

  const rows =
    orders.length === 0
      ? `<tr><td colspan="7" class="muted" style="padding:32px;text-align:center">No orders${filter !== "all" ? " with this status" : " yet"}.</td></tr>`
      : orders
          .map(
            (o) => `<tr>
        <td>${fmtDate(esc(o.created_at))}</td>
        <td><strong>${esc(o.order_ref)}</strong>${o.razorpay_payment_id ? `<br><span class="muted" style="font-size:11px">${esc(o.razorpay_payment_id)}</span>` : ""}</td>
        <td>${esc(o.customer_name)}<br><span class="muted" style="font-size:12px">${esc(o.phone)}<br>${esc(o.email)}</span><br><span class="muted" style="font-size:12px">${esc(o.address)}, ${esc(o.pincode)}</span></td>
        <td>${itemsCell(o.items)}</td>
        <td>${o.method === "cod" ? "COD" : "Online"}</td>
        <td><strong>${money(o.amount_total)}</strong><br><span class="muted" style="font-size:11px">sub ${money(o.amount_subtotal)} · ship ${money(o.amount_shipping)}${o.amount_discount ? ` · −${money(o.amount_discount)}${o.coupon_code ? ` (${esc(o.coupon_code)})` : ""}` : ""}</span></td>
        <td><span class="badge s-${esc(o.status)}">${esc(o.status).replace("_", " ")}</span><div style="margin-top:8px">${statusForm(o.order_ref, o.status, filter)}</div></td>
      </tr>`,
          )
          .join("");

  const body = `
    <h1>Orders</h1>
    <p class="muted">Showing ${orders.length} order${orders.length === 1 ? "" : "s"}${filter !== "all" ? ` · filtered by “${esc(filter)}”` : ""}.</p>
    ${updated ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Order ${esc(updated)} updated.</div>` : ""}
    ${statCards}
    ${filterTabs}
    <table>
      <thead><tr><th>Date</th><th>Ref</th><th>Customer</th><th>Items</th><th>Method</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(adminPage({ title: "Orders", body }));
};
