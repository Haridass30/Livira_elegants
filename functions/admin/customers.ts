/** /admin/customers — customer list derived from orders (grouped by phone). */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../_lib/adminHtml";
import { listCustomers } from "../_lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const customers = await listCustomers(env);

  const totalSpent = customers.reduce((s, c) => s + c.total_spent, 0);
  const repeat = customers.filter((c) => c.order_count > 1).length;

  const rows =
    customers.length === 0
      ? `<tr><td colspan="6" class="muted" style="padding:28px;text-align:center">No customers yet.</td></tr>`
      : customers
          .map(
            (c) => `<tr>
        <td><strong>${esc(c.customer_name)}</strong></td>
        <td>${esc(c.phone)}<br><span class="muted" style="font-size:12px">${esc(c.email)}</span></td>
        <td style="max-width:260px">${esc(c.address)}<br><span class="muted" style="font-size:12px">PIN ${esc(c.pincode)}</span></td>
        <td>${c.order_count}</td>
        <td><strong>${money(c.total_spent)}</strong></td>
        <td>${esc(c.last_order_at.split(" ")[0] ?? "")}</td>
      </tr>`,
          )
          .join("");

  const body = `
    <h1>Customers</h1>
    <p class="muted">Built automatically from orders (grouped by phone number; cancelled/failed orders excluded).</p>
    <div class="stats">
      <div class="stat"><div class="label">Customers</div><div class="value">${customers.length}</div></div>
      <div class="stat"><div class="label">Repeat customers</div><div class="value">${repeat}</div></div>
      <div class="stat"><div class="label">Lifetime value</div><div class="value">${money(totalSpent)}</div></div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Contact</th><th>Address</th><th>Orders</th><th>Total spent</th><th>Last order</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(adminPage({ title: "Customers", body }));
};
