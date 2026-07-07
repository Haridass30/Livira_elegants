import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { $cart, $cartSubtotal, clearCart } from "../../stores/cart";
import { formatINR } from "../../lib/format";
import { site } from "../../config";
import type { CheckoutMethod, CustomerInput } from "../../lib/types";

// Razorpay Checkout is injected from its CDN script (handles all card data).
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SDK = "https://checkout.razorpay.com/v1/checkout.js";

type FieldErrors = Partial<Record<keyof CustomerInput, string>>;

/** Live store config from /api/config (admin-editable without redeploy). */
interface StoreConfig {
  codEnabled: boolean;
  onlineEnabled: boolean;
  codMaxOrderValue: number;
  freeShippingThreshold: number;
  flatShippingFee: number;
  disabledProducts: string[];
}

export default function CheckoutForm() {
  const lines = useStore($cart);
  const subtotal = useStore($cartSubtotal);

  const [customer, setCustomer] = useState<CustomerInput>({
    name: "",
    phone: "",
    email: "",
    address: "",
    pincode: "",
  });
  const [method, setMethod] = useState<CheckoutMethod>("online");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Coupon state — validated server-side; this is display only.
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Live settings; fall back to the static site config until loaded.
  const [config, setConfig] = useState<StoreConfig | null>(null);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setConfig(c as StoreConfig))
      .catch(() => {});
  }, []);

  const freeShippingThreshold = config?.freeShippingThreshold ?? site.freeShippingThreshold;
  const flatShippingFee = config?.flatShippingFee ?? site.flatShippingFee;
  const codMaxOrderValue = config?.codMaxOrderValue ?? site.codMaxOrderValue;

  const shipping = useMemo(
    () =>
      subtotal === 0 || subtotal >= freeShippingThreshold ? 0 : flatShippingFee,
    [subtotal, freeShippingThreshold, flatShippingFee],
  );
  const discount = coupon ? Math.min(coupon.discount, subtotal) : 0;
  const total = Math.max(0, subtotal - discount) + shipping;

  // Guard rails (mirror the server, which is authoritative).
  const codEnabled = config?.codEnabled ?? true;
  const onlineEnabled = config?.onlineEnabled ?? true;
  const codAllowed = codEnabled && total <= codMaxOrderValue;
  const effectiveMethod: CheckoutMethod =
    method === "cod"
      ? codAllowed
        ? "cod"
        : "online"
      : onlineEnabled
        ? "online"
        : codAllowed
          ? "cod"
          : "online";

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          items: lines.map((l) => ({ slug: l.slug, qty: l.qty })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        code?: string;
        discount?: number;
        error?: string;
        errors?: string[];
      };
      if (res.ok && data.ok && data.code) {
        setCoupon({ code: data.code, discount: data.discount ?? 0 });
        setCouponInput("");
      } else {
        setCouponError(data.error || data.errors?.join(" ") || "Invalid coupon.");
      }
    } catch {
      setCouponError("Could not check the coupon. Try again.");
    } finally {
      setCouponBusy(false);
    }
  }

  function update(field: keyof CustomerInput, value: string) {
    setCustomer((c) => ({ ...c, [field]: value }));
    setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate(): boolean {
    const e: FieldErrors = {};
    if (customer.name.trim().length < 2) e.name = "Enter your full name.";
    if (!/^[0-9]{10}$/.test(customer.phone.replace(/\D/g, "").slice(-10)))
      e.phone = "Enter a valid 10-digit number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
      e.email = "Enter a valid email.";
    if (customer.address.trim().length < 8)
      e.address = "Enter your full address.";
    if (!/^[1-9][0-9]{5}$/.test(customer.pincode))
      e.pincode = "Enter a valid 6-digit pincode.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  function loadRazorpay(): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const s = document.createElement("script");
      s.src = RAZORPAY_SDK;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
  }

  function goToConfirmation(ref: string) {
    clearCart();
    window.location.href = `/order/confirmation?ref=${encodeURIComponent(ref)}`;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setBusy(true);

    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: effectiveMethod,
          customer,
          couponCode: coupon?.code,
          // Server only trusts slug + qty; it re-prices everything.
          items: lines.map((l) => ({ slug: l.slug, qty: l.qty })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setServerError(
          (data?.errors && data.errors.join(" ")) ||
            data?.error ||
            "We couldn't place your order. Please try again.",
        );
        setBusy(false);
        return;
      }

      // ----- COD: order recorded server-side, we're done. -----
      if (effectiveMethod === "cod") {
        goToConfirmation(data.order_ref);
        return;
      }

      // ----- Online: open Razorpay Checkout with the server's order. -----
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) {
        setServerError("Could not load the payment window. Please retry.");
        setBusy(false);
        return;
      }

      const rzp = new window.Razorpay({
        key: data.razorpay_key_id,
        order_id: data.razorpay_order_id,
        amount: data.amount, // paise, from the server
        currency: data.currency,
        name: site.name,
        description: `Order ${data.order_ref}`,
        image: "/og-default.jpg",
        prefill: {
          name: customer.name,
          email: customer.email,
          contact: customer.phone,
        },
        notes: { order_ref: data.order_ref },
        theme: { color: "#cf9a6e" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          // Verify the signature server-side before trusting the payment.
          const v = await fetch("/api/orders/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(resp),
          });
          const vdata = await v.json();
          if (v.ok && vdata.status === "paid") {
            goToConfirmation(vdata.order_ref ?? data.order_ref);
          } else {
            setServerError(
              "Payment could not be verified. If money was deducted, contact us with your reference.",
            );
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      rzp.open();
    } catch {
      setServerError("Something went wrong. Please check your connection and retry.");
      setBusy(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-charcoal/60">Your bag is empty.</p>
        <a href="/shop" className="btn btn-outline mt-6">
          Browse the collection
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-12 lg:grid-cols-[1.3fr_1fr]"
      noValidate
    >
      {/* ---------------- Details ---------------- */}
      <div>
        <h2 className="font-serif text-2xl">Delivery details</h2>
        <div className="mt-6 grid gap-5">
          <Field
            label="Full name"
            value={customer.name}
            onChange={(v) => update("name", v)}
            error={fieldErrors.name}
            autoComplete="name"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Phone"
              type="tel"
              value={customer.phone}
              onChange={(v) => update("phone", v)}
              error={fieldErrors.phone}
              autoComplete="tel"
              inputMode="numeric"
            />
            <Field
              label="Email"
              type="email"
              value={customer.email}
              onChange={(v) => update("email", v)}
              error={fieldErrors.email}
              autoComplete="email"
            />
          </div>
          <Field
            label="Delivery address"
            value={customer.address}
            onChange={(v) => update("address", v)}
            error={fieldErrors.address}
            autoComplete="street-address"
            multiline
          />
          <div className="sm:max-w-[12rem]">
            <Field
              label="Pincode"
              value={customer.pincode}
              onChange={(v) => update("pincode", v)}
              error={fieldErrors.pincode}
              autoComplete="postal-code"
              inputMode="numeric"
            />
          </div>
        </div>

        {/* ---------------- Payment method ---------------- */}
        <h2 className="mt-10 font-serif text-2xl">Payment</h2>
        <div className="mt-5 space-y-3">
          <MethodOption
            id="online"
            checked={effectiveMethod === "online"}
            onSelect={() => onlineEnabled && setMethod("online")}
            disabled={!onlineEnabled}
            title="Pay online"
            subtitle={
              onlineEnabled
                ? "Card, UPI, netbanking — secured by Razorpay."
                : "Online payment is temporarily unavailable."
            }
          />
          <MethodOption
            id="cod"
            checked={effectiveMethod === "cod"}
            onSelect={() => codAllowed && setMethod("cod")}
            disabled={!codAllowed}
            title="Cash on Delivery"
            subtitle={
              !codEnabled
                ? "Cash on Delivery is temporarily unavailable."
                : codAllowed
                  ? "Pay in cash when your order arrives."
                  : `Unavailable above ${formatINR(codMaxOrderValue)} — please pay online.`
            }
          />
        </div>

        {serverError && (
          <p
            role="alert"
            className="mt-6 border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            {serverError}
          </p>
        )}
      </div>

      {/* ---------------- Summary ---------------- */}
      <aside className="h-fit border hairline bg-bone/40 p-6 lg:sticky lg:top-28">
        <h2 className="font-serif text-xl">Order summary</h2>
        <ul className="mt-5 divide-y divide-charcoal/10">
          {lines.map((l) => (
            <li key={l.slug} className="flex items-center gap-3 py-3">
              <img
                src={l.image}
                alt={l.name}
                width={48}
                height={60}
                className="h-[60px] w-[48px] rounded-[2px] object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{l.name}</p>
                <p className="text-xs text-charcoal/55">Qty {l.qty}</p>
              </div>
              <span className="text-sm">{formatINR(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        {/* Coupon */}
        <div className="mt-4 border-t hairline pt-4">
          {coupon ? (
            <div className="flex items-center justify-between text-sm">
              <span>
                Coupon <strong>{coupon.code}</strong> applied
              </span>
              <button
                type="button"
                onClick={() => setCoupon(null)}
                className="text-xs text-charcoal/50 underline hover:text-charcoal"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Coupon code"
                aria-label="Coupon code"
                className="min-w-0 flex-1 border border-charcoal/25 bg-ivory px-3 py-2 text-sm uppercase outline-none focus:border-champagne"
              />
              <button
                type="button"
                onClick={applyCoupon}
                disabled={couponBusy || !couponInput.trim()}
                className="btn btn-outline px-4 py-2 text-[11px]"
              >
                {couponBusy ? "…" : "Apply"}
              </button>
            </div>
          )}
          {couponError && (
            <p className="mt-2 text-xs text-red-400">{couponError}</p>
          )}
        </div>

        <dl className="mt-4 space-y-2 border-t hairline pt-4 text-sm">
          <Row label="Subtotal" value={formatINR(subtotal)} />
          {discount > 0 && (
            <Row label={`Discount (${coupon!.code})`} value={`−${formatINR(discount)}`} />
          )}
          <Row
            label="Shipping"
            value={shipping === 0 ? "Free" : formatINR(shipping)}
          />
          <div className="flex justify-between border-t hairline pt-3">
            <dt className="font-serif text-lg">Total</dt>
            <dd className="font-serif text-lg">{formatINR(total)}</dd>
          </div>
        </dl>
        {site.showGstNote && (
          <p className="mt-1 text-right text-[11px] text-charcoal/45">
            {site.gstNote}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || (!onlineEnabled && !codAllowed)}
          className="btn btn-primary mt-6 w-full"
        >
          {busy
            ? "Processing…"
            : effectiveMethod === "cod"
              ? "Place COD order"
              : `Pay ${formatINR(total)}`}
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-charcoal/50">
          Prices are confirmed on our server at checkout.
          {/* TODO(owner): optional — add a phone OTP step before COD here. */}
        </p>
      </aside>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  inputMode,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  multiline?: boolean;
}) {
  const id = `f-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const cls =
    "mt-1.5 w-full border bg-ivory px-3.5 py-3 text-sm outline-none transition-colors focus:border-champagne " +
    (error ? "border-red-400" : "border-charcoal/25");
  return (
    <div>
      <label htmlFor={id} className="text-xs uppercase tracking-[0.12em] text-charcoal/60">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          rows={3}
          className={cls}
          aria-invalid={!!error}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          className={cls}
          aria-invalid={!!error}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function MethodOption({
  id,
  checked,
  onSelect,
  title,
  subtitle,
  disabled,
}: {
  id: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={`m-${id}`}
      className={`flex cursor-pointer items-start gap-3 border p-4 transition-colors ${
        checked ? "border-champagne bg-champagne/5" : "border-charcoal/20"
      } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <input
        id={`m-${id}`}
        type="radio"
        name="method"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1 accent-champagne"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-charcoal/60">{subtitle}</span>
      </span>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-charcoal/75">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
