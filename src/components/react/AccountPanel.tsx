import { useEffect, useState } from "react";
import { formatINR } from "../../lib/format";

interface Account {
  id: number;
  email: string;
  name: string;
  phone: string;
  street: string;
  landmark: string;
  city: string;
  pincode: string;
}
interface Order {
  order_ref: string;
  created_at: string;
  status: string;
  method: string;
  amount_total: number;
  currency: string;
  items: string;
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as { ok: boolean; data: any };
}
const errMsg = (d: any, fallback: string) =>
  (Array.isArray(d?.errors) && d.errors.join(" ")) || d?.error || fallback;

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  cod_pending: "COD — confirmed",
  pending: "Awaiting payment",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default function AccountPanel() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/account/me", { headers: { accept: "application/json" } });
    const data = await res.json().catch(() => ({}));
    setAccount(data.account ?? null);
    setOrders(Array.isArray(data.orders) ? data.orders : []);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const url = mode === "login" ? "/api/account/login" : "/api/account/register";
    const body =
      mode === "login"
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };
    const { ok, data } = await post(url, body);
    setBusy(false);
    if (!ok) return setError(errMsg(data, "Something went wrong."));
    setForm({ name: "", email: "", password: "" });
    refresh();
  }

  async function logout() {
    await post("/api/account/logout");
    setAccount(null);
    setOrders([]);
  }

  if (loading) return <p className="py-16 text-center text-charcoal/50">Loading…</p>;

  // ---- Signed out: login / register ----
  if (!account) {
    return (
      <div className="mx-auto max-w-md">
        <div className="text-center">
          <p className="eyebrow">Your account</p>
          <h1 className="mt-3 font-serif text-4xl">{mode === "login" ? "Welcome back" : "Create account"}</h1>
          <p className="mt-3 text-sm text-charcoal/60">
            {mode === "login"
              ? "Sign in to see your orders and reorder faster."
              : "Save your details for faster checkout and order tracking."}
          </p>
        </div>

        {error && <div className="mt-6 border border-[#c98] bg-[#faefe9] p-3 text-sm text-[#8a2f2f]">{error}</div>}

        <form onSubmit={submitAuth} className="mt-6 grid gap-4">
          {mode === "register" && (
            <input
              className="input" placeholder="Full name" autoComplete="name" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <input
            className="input" type="email" placeholder="Email" autoComplete="email" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="input" type="password" placeholder="Password" required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-charcoal/60">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button
            type="button"
            className="link-underline text-champagne"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>

        <style>{`.input{width:100%;padding:12px 14px;border:1px solid color-mix(in srgb,var(--color-champagne) 34%,transparent);background:var(--color-ivory);border-radius:2px;outline:none}.input:focus{border-color:var(--color-champagne)}`}</style>
      </div>
    );
  }

  // ---- Signed in: dashboard ----
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your account</p>
          <h1 className="mt-2 font-serif text-3xl md:text-4xl">Hello, {account.name || "there"}</h1>
          <p className="mt-1 text-sm text-charcoal/60">{account.email}</p>
        </div>
        <button type="button" onClick={logout} className="btn btn-outline">Sign out</button>
      </div>

      <SavedAddress account={account} onSaved={setAccount} />

      <div className="mt-12">
        <h2 className="font-serif text-2xl">Your orders</h2>
        {orders.length === 0 ? (
          <p className="mt-4 text-sm text-charcoal/60">
            No orders yet. <a href="/shop" className="link-underline text-champagne">Start shopping →</a>
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-charcoal/10 border-y hairline">
            {orders.map((o) => {
              let count = 0;
              try { const arr = JSON.parse(o.items); count = Array.isArray(arr) ? arr.reduce((n: number, l: any) => n + (l.qty || 1), 0) : 0; } catch {}
              return (
                <li key={o.order_ref} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium">{o.order_ref}</p>
                    <p className="text-xs text-charcoal/55">
                      {new Date(o.created_at + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {count ? ` · ${count} item${count === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{formatINR(o.amount_total)}</p>
                    <p className="text-[11px] uppercase tracking-[0.1em] text-champagne">{STATUS_LABEL[o.status] ?? o.status}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SavedAddress({ account, onSaved }: { account: Account; onSaved: (a: Account) => void }) {
  const [f, setF] = useState({
    name: account.name, phone: account.phone, street: account.street,
    landmark: account.landmark, city: account.city, pincode: account.pincode,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { ok, data } = await post("/api/account/update", f);
    setBusy(false);
    if (ok && data.account) { onSaved(data.account); setMsg("Saved ✓"); setTimeout(() => setMsg(null), 1800); }
    else setMsg("Could not save.");
  }
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={save} className="mt-10 border hairline p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl">Saved details</h2>
        {msg && <span className="text-sm text-champagne">{msg}</span>}
      </div>
      <p className="mt-1 text-sm text-charcoal/55">Used to auto-fill your next checkout.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <input className="ai" placeholder="Full name" value={f.name} onChange={upd("name")} />
        <input className="ai" placeholder="Phone" value={f.phone} onChange={upd("phone")} inputMode="numeric" />
        <input className="ai sm:col-span-2" placeholder="Street / house no." value={f.street} onChange={upd("street")} />
        <input className="ai sm:col-span-2" placeholder="Landmark (optional)" value={f.landmark} onChange={upd("landmark")} />
        <input className="ai" placeholder="City / town" value={f.city} onChange={upd("city")} />
        <input className="ai" placeholder="Pincode" value={f.pincode} onChange={upd("pincode")} inputMode="numeric" />
      </div>
      <button type="submit" disabled={busy} className="btn btn-primary mt-5">{busy ? "Saving…" : "Save details"}</button>
      <style>{`.ai{width:100%;padding:11px 13px;border:1px solid color-mix(in srgb,var(--color-champagne) 30%,transparent);background:var(--color-ivory);border-radius:2px;outline:none}.ai:focus{border-color:var(--color-champagne)}`}</style>
    </form>
  );
}
