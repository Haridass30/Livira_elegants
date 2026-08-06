/** Admin dashboard: headline stats + recent orders with inline status updates. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../_lib/adminHtml";
import { getStats, listOrders, type OrderListRow } from "../_lib/db";
import { getSettings } from "../_lib/settings";
import { sweepExpiredHolds } from "../_lib/paymentHold";
import { notifyCustomer, summariseOrderRow } from "../_lib/email";
import { formatUpiRef } from "../_lib/upi";
import type { PricedLine } from "../../src/lib/types";

const STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "cod_pending",
  "shipped",
  "delivered",
  "cancelled",
  "failed",
];

const FILTERS: [string, string][] = [
  ["all", "All"],
  ["awaiting_payment", "Awaiting payment"],
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

/**
 * The verification panel — shown instead of the plain status dropdown while an
 * order is `awaiting_payment`. It puts the two facts the owner needs (amount and
 * reference) next to the two buttons that resolve the order, so confirming a
 * payment is a deliberate act against evidence rather than a status change.
 */
function verifyPanel(o: OrderListRow, filter: string): string {
  const proof = o.payment_proof_id
    ? `<a href="/admin/orders/proof?id=${o.payment_proof_id}" target="_blank" rel="noopener">View payment screenshot ↗</a>`
    : `<span class="muted">No screenshot attached.</span>`;

  return `<div class="verify">
    <p><strong>Not verified.</strong> Customer claims they sent <strong>${money(o.amount_total)}</strong>.</p>
    <p>UTR <code>${o.upi_ref ? esc(formatUpiRef(o.upi_ref)) : "—"}</code></p>
    <p>${proof}</p>
    <p class="muted">Check your bank / UPI app for this credit before confirming.</p>
    <form method="post" action="/admin/orders/verify">
      <input type="hidden" name="order_ref" value="${esc(o.order_ref)}"/>
      <input type="hidden" name="filter" value="${esc(filter)}"/>
      <input type="text" name="note" placeholder="Note / reason (optional)" maxlength="300"/>
      <div class="row">
        <button class="yes" type="submit" name="action" value="confirm">✓ Money received</button>
        <button class="no" type="submit" name="action" value="reject">✕ Not received</button>
      </div>
    </form>
  </div>`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") || "all";
  const updated = url.searchParams.get("updated");
  const errorMsg = url.searchParams.get("error");
  const q = (url.searchParams.get("q") || "").trim();

  // Release stock from unverified orders that ran out of time before listing.
  const settings = await getSettings(env);
  const expired = await sweepExpiredHolds(env, settings.upiHoldHours);
  if (expired.length) {
    waitUntil(
      Promise.all(
        expired.map((o) => notifyCustomer(env, summariseOrderRow(o), "expired")),
      ),
    );
  }

  const [stats, allOrders] = await Promise.all([
    getStats(env),
    listOrders(env, filter, 200),
  ]);

  const ql = q.toLowerCase();
  const orders = q
    ? allOrders.filter((o) =>
        [o.order_ref, o.customer_name, o.phone, o.email].some((v) =>
          String(v ?? "").toLowerCase().includes(ql),
        ),
      )
    : allOrders;

  const statCards = `
    <div class="stats">
      <div class="stat"><div class="label">Revenue (paid + delivered)</div><div class="value">${money(stats.revenue)}</div></div>
      <div class="stat" style="${stats.awaitingCount ? "border-color:#e6cf9f;background:#fff8ec" : ""}">
        <div class="label">Awaiting verification</div>
        <div class="value">${stats.awaitingCount}</div>
        <div class="label" style="letter-spacing:0;text-transform:none">${money(stats.awaitingValue)} claimed — not counted as revenue</div>
      </div>
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
        <td><strong>${esc(o.order_ref)}</strong>${
          o.upi_ref
            ? `<br><span style="font-size:11px;color:${o.status === "paid" || o.status === "shipped" || o.status === "delivered" ? "#2f6b3a" : "#8a6d1e"}">UPI ${esc(formatUpiRef(o.upi_ref))}${o.verified_at ? " ✓ checked" : " · unverified"}</span>`
            : o.notes
              ? `<br><span style="font-size:11px;color:#8a6d1e">${esc(o.notes)}</span>`
              : ""
        }${o.verified_note ? `<br><span class="muted" style="font-size:11px">${esc(o.verified_note)}</span>` : ""}${o.razorpay_payment_id ? `<br><span class="muted" style="font-size:11px">${esc(o.razorpay_payment_id)}</span>` : ""}</td>
        <td>${esc(o.customer_name)}<br><span class="muted" style="font-size:12px">${esc(o.phone)}<br>${esc(o.email)}</span><br><span class="muted" style="font-size:12px">${esc(o.address)}, ${esc(o.pincode)}</span><br><a href="/admin/orders/edit?ref=${encodeURIComponent(o.order_ref)}" style="font-size:11px">✎ Edit details</a></td>
        <td>${itemsCell(o.items)}</td>
        <td>${o.method === "cod" ? "COD" : "Online"}</td>
        <td><strong>${money(o.amount_total)}</strong><br><span class="muted" style="font-size:11px">sub ${money(o.amount_subtotal)} · ship ${money(o.amount_shipping)}${o.amount_discount ? ` · −${money(o.amount_discount)}${o.coupon_code ? ` (${esc(o.coupon_code)})` : ""}` : ""}</span></td>
        <td><span class="badge s-${esc(o.status)}">${esc(o.status).replace(/_/g, " ")}</span>${
          o.status === "awaiting_payment"
            ? verifyPanel(o, filter)
            : `<div style="margin-top:8px">${statusForm(o.order_ref, o.status, filter)}</div>`
        }</td>
      </tr>`,
          )
          .join("");

  const body = `
    <h1>Orders</h1>
    <p class="muted">Showing ${orders.length} order${orders.length === 1 ? "" : "s"}${filter !== "all" ? ` · filtered by “${esc(filter)}”` : ""}${q ? ` · matching “${esc(q)}”` : ""}.</p>
    ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ""}
    ${
      updated
        ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Order ${esc(updated)} ${
            url.searchParams.get("verified")
              ? "marked paid — the customer has been emailed their confirmation."
              : url.searchParams.get("rejected")
                ? "rejected — stock released and the customer has been emailed."
                : "updated."
          }</div>`
        : ""
    }
    ${
      stats.awaitingCount && filter !== "awaiting_payment"
        ? `<div class="err" style="background:#fff8ec;color:#8a4b0e">
             ${stats.awaitingCount} order${stats.awaitingCount === 1 ? "" : "s"} waiting on payment verification —
             <a href="/admin?status=awaiting_payment" style="color:#8a4b0e">review ${stats.awaitingCount === 1 ? "it" : "them"}</a>.
             These are unverified claims: never dispatch before you see the money in your account.
           </div>`
        : ""
    }
    ${statCards}
    <form method="get" style="margin:16px 0 8px;display:flex;gap:8px;max-width:460px">
      <input type="hidden" name="status" value="${esc(filter)}"/>
      <input name="q" value="${esc(q)}" placeholder="Search order ref, name, phone or email…" style="flex:1;padding:9px 12px;border:1px solid rgba(43,39,36,.25);border-radius:7px"/>
      <button type="submit">Search</button>
      ${q ? `<a href="/admin?status=${esc(filter)}"><button type="button" style="background:#fff;color:var(--char);border:1px solid rgba(43,39,36,.25)">Clear</button></a>` : ""}
    </form>
    ${filterTabs}
    <table>
      <thead><tr><th>Date</th><th>Ref</th><th>Customer</th><th>Items</th><th>Method</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(adminPage({ title: "Orders", body }));
};
