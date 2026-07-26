/** D1 access for customer accounts + their order history (matched by email). */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";

export interface Account {
  id: number;
  email: string;
  name: string;
  phone: string;
  street: string;
  landmark: string;
  city: string;
  pincode: string;
  created_at: string;
}

interface AccountRow extends Account {
  password_hash: string;
}

export interface AccountOrder {
  order_ref: string;
  created_at: string;
  status: string;
  method: string;
  amount_total: number;
  currency: string;
  items: string;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function getAccountByEmail(env: Env, email: string): Promise<AccountRow | null> {
  return env.DB.prepare(`SELECT * FROM accounts WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<AccountRow>();
}

export async function getAccountById(env: Env, id: number): Promise<Account | null> {
  const row = await env.DB.prepare(
    `SELECT id, email, name, phone, street, landmark, city, pincode, created_at
     FROM accounts WHERE id = ?`,
  )
    .bind(id)
    .first<Account>();
  return row ?? null;
}

export async function createAccount(
  env: Env,
  input: { email: string; passwordHash: string; name: string },
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO accounts (email, password_hash, name) VALUES (?, ?, ?)`,
  )
    .bind(normalizeEmail(input.email), input.passwordHash, input.name.trim())
    .run();
  return Number(res.meta.last_row_id);
}

export async function updateAccountProfile(
  env: Env,
  id: number,
  p: { name: string; phone: string; street: string; landmark: string; city: string; pincode: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE accounts SET name=?, phone=?, street=?, landmark=?, city=?, pincode=? WHERE id=?`,
  )
    .bind(p.name.trim(), p.phone.trim(), p.street.trim(), p.landmark.trim(), p.city.trim(), p.pincode.trim(), id)
    .run();
}

/** Orders placed with this email (guest or logged-in), newest first. */
export async function listAccountOrders(env: Env, email: string): Promise<AccountOrder[]> {
  const res = await env.DB.prepare(
    `SELECT order_ref, created_at, status, method, amount_total, currency, items
     FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(normalizeEmail(email))
    .all<AccountOrder>();
  return res.results ?? [];
}
