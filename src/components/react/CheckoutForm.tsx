import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { $cart, $cartSubtotal, clearCart } from "../../stores/cart";
import { formatINR } from "../../lib/format";
import { site } from "../../config";
import QRCode from "qrcode";
import type { CheckoutMethod, CustomerInput } from "../../lib/types";

type FieldErrors = Partial<Record<keyof CustomerInput, string>>;

/** Live store config from /api/config (admin-editable without redeploy). */
interface StoreConfig {
  codEnabled: boolean;
  onlineEnabled: boolean;
  codMaxOrderValue: number;
  freeShippingThreshold: number;
  flatShippingFee: number;
  disabledProducts: string[];
  upi?: { id: string; name: string };
  /** Owner requires a payment screenshot with the UPI reference. */
  upiProofRequired?: boolean;
}

/** A UTR is exactly 12 digits — mirrors functions/_lib/upi.ts. */
const UTR_DIGITS = 12;

/**
 * Shrink a screenshot to something worth emailing around. Falls back to the
 * raw file when the browser can't decode it (older iOS HEIC, mainly).
 */
async function toProofDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }
}

export default function CheckoutForm() {
  const lines = useStore($cart);
  const subtotal = useStore($cartSubtotal);

  const [customer, setCustomer] = useState<CustomerInput>({
    name: "",
    phone: "",
    email: "",
    street: "",
    landmark: "",
    city: "",
    address: "",
    pincode: "",
  });
  const [method, setMethod] = useState<CheckoutMethod>("online");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [upiRef, setUpiRef] = useState("");
  const [upiQr, setUpiQr] = useState("");
  const [proof, setProof] = useState<{ dataUrl: string; name: string } | null>(null);
  const [proofBusy, setProofBusy] = useState(false);

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

  // Auto-fill from the signed-in customer's saved details (empty fields only).
  useEffect(() => {
    fetch("/api/account/me", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const a = d?.account;
        if (!a) return;
        setCustomer((c) => ({
          ...c,
          name: c.name || a.name || "",
          phone: c.phone || a.phone || "",
          email: c.email || a.email || "",
          street: c.street || a.street || "",
          landmark: c.landmark || a.landmark || "",
          city: c.city || a.city || "",
          pincode: c.pincode || a.pincode || "",
        }));
      })
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

  // UPI deep-link + QR for manual online payment (opens the customer's UPI app).
  const upiId = config?.upi?.id ?? "";
  const proofRequired = config?.upiProofRequired ?? true;
  const upiRefDigits = upiRef.replace(/\D/g, "");
  const upiLink = useMemo(() => {
    if (!upiId) return "";
    const p = new URLSearchParams({
      pa: upiId,
      pn: config?.upi?.name || site.name,
      am: String(total),
      cu: "INR",
      tn: `${site.name} order`,
    });
    return `upi://pay?${p.toString()}`;
  }, [upiId, config?.upi?.name, total]);

  useEffect(() => {
    if (!upiLink) {
      setUpiQr("");
      return;
    }
    QRCode.toDataURL(upiLink, { margin: 1, width: 360 })
      .then(setUpiQr)
      .catch(() => setUpiQr(""));
  }, [upiLink]);

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
    if (customer.street.trim().length < 3)
      e.street = "Enter your street / house no.";
    if (customer.city.trim().length < 2) e.city = "Enter your city / town.";
    if (!/^[1-9][0-9]{5}$/.test(customer.pincode))
      e.pincode = "Enter a valid 6-digit pincode.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleProofPick(file: File | undefined) {
    if (!file) return;
    setServerError(null);
    setProofBusy(true);
    try {
      const dataUrl = await toProofDataUrl(file);
      // Rough base64 → bytes; the server enforces the real 1.2 MB limit.
      if (dataUrl.length * 0.75 > 1_200_000) {
        setServerError("That screenshot is too large — please attach a smaller one.");
      } else {
        setProof({ dataUrl, name: file.name });
      }
    } catch {
      setServerError("We couldn't read that image. Please try another screenshot.");
    } finally {
      setProofBusy(false);
    }
  }

  function goToConfirmation(ref: string, status: string) {
    clearCart();
    window.location.href = `/order/confirmation?ref=${encodeURIComponent(
      ref,
    )}&status=${encodeURIComponent(status)}`;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    // Online = manual UPI. The reference is only a claim — the server records
    // the order as awaiting verification — but a value that can't be a UTR is
    // caught here so it never reaches the owner's queue.
    if (effectiveMethod === "online") {
      if (upiRefDigits.length !== UTR_DIGITS) {
        setServerError(
          `The UPI reference is exactly ${UTR_DIGITS} digits — copy the UTR from your payment app.`,
        );
        return;
      }
      if (proofRequired && !proof) {
        setServerError("Please attach the payment screenshot from your UPI app.");
        return;
      }
    }
    setBusy(true);

    // Compose the full delivery address from the structured fields.
    const customerToSend: CustomerInput = {
      ...customer,
      address: [customer.street, customer.landmark, customer.city]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", "),
    };

    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: effectiveMethod,
          customer: customerToSend,
          couponCode: coupon?.code,
          upiRef: effectiveMethod === "online" ? upiRefDigits : undefined,
          paymentProof:
            effectiveMethod === "online" && proof ? proof.dataUrl : undefined,
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

      // Order recorded. For manual UPI that means "awaiting_payment", not a
      // sale — the confirmation page words itself from this status.
      goToConfirmation(data.order_ref, data.status ?? "");
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
            label="Street / House no."
            value={customer.street}
            onChange={(v) => update("street", v)}
            error={fieldErrors.street}
            autoComplete="address-line1"
            multiline
          />
          <Field
            label="Landmark (optional)"
            value={customer.landmark}
            onChange={(v) => update("landmark", v)}
            autoComplete="address-line2"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="City / Town"
              value={customer.city}
              onChange={(v) => update("city", v)}
              error={fieldErrors.city}
              autoComplete="address-level2"
            />
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
            title="Pay online (UPI)"
            subtitle={
              onlineEnabled
                ? "Pay to our UPI id from any UPI app, then send us the reference — we confirm once we see the money."
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

        {effectiveMethod === "online" && (
          <div className="mt-4 border hairline p-5">
            {upiId ? (
              <>
                <p className="font-serif text-lg">
                  Pay {formatINR(total)} via UPI
                </p>
                <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
                  {upiQr && (
                    <img
                      src={upiQr}
                      alt="Scan to pay via UPI"
                      width={150}
                      height={150}
                      className="border hairline"
                    />
                  )}
                  <div className="text-center text-sm sm:text-left">
                    <p className="text-charcoal/70">Scan with any UPI app, or pay to:</p>
                    <p className="mt-2 select-all font-medium text-charcoal">{upiId}</p>
                    {config?.upi?.name && (
                      <p className="text-charcoal/55">{config.upi.name}</p>
                    )}
                    {upiLink && (
                      <a href={upiLink} className="btn btn-primary mt-3 sm:hidden">
                        Open UPI app
                      </a>
                    )}
                  </div>
                </div>
                <label className="mt-5 block text-xs uppercase tracking-[0.12em] text-charcoal/60">
                  UPI reference / UTR — {UTR_DIGITS} digits
                  <input
                    value={upiRef}
                    onChange={(e) =>
                      setUpiRef(e.target.value.replace(/\D/g, "").slice(0, UTR_DIGITS))
                    }
                    placeholder="e.g. 412345678901"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={UTR_DIGITS}
                    aria-describedby="upi-ref-help"
                    className="mt-2 w-full border hairline bg-ivory px-3 py-2.5 font-mono normal-case tracking-normal text-charcoal outline-none focus:border-champagne"
                  />
                </label>
                <p id="upi-ref-help" className="mt-1.5 text-xs text-charcoal/55">
                  {upiRefDigits.length > 0 && upiRefDigits.length < UTR_DIGITS
                    ? `${UTR_DIGITS - upiRefDigits.length} more digit${
                        UTR_DIGITS - upiRefDigits.length === 1 ? "" : "s"
                      } — open the payment in your UPI app and copy the UTR / transaction reference.`
                    : "Open the completed payment in your UPI app and copy the UTR / transaction reference."}
                </p>

                {/* Payment screenshot — the owner's evidence when matching the credit. */}
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-[0.12em] text-charcoal/60">
                    Payment screenshot {proofRequired ? "" : "(optional)"}
                  </p>
                  {proof ? (
                    <div className="mt-2 flex items-center gap-3 border hairline bg-ivory p-2.5">
                      <img
                        src={proof.dataUrl}
                        alt="Your payment screenshot"
                        className="h-14 w-14 object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-charcoal/70">
                        {proof.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setProof(null)}
                        className="text-xs text-charcoal/50 underline hover:text-charcoal"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleProofPick(e.target.files?.[0])}
                      disabled={proofBusy}
                      className="mt-2 w-full border hairline bg-ivory px-3 py-2.5 text-xs text-charcoal/70 file:mr-3 file:border-0 file:bg-charcoal file:px-3 file:py-1.5 file:text-xs file:text-ivory"
                    />
                  )}
                  <p className="mt-1.5 text-xs text-charcoal/55">
                    {proofBusy
                      ? "Preparing your screenshot…"
                      : "The success screen from your UPI app, showing the amount and reference."}
                  </p>
                </div>

                <p className="mt-5 border-l-2 border-champagne bg-champagne/5 px-3 py-2.5 text-xs leading-relaxed text-charcoal/70">
                  <strong className="text-charcoal">Your order isn't confirmed yet.</strong> We hold
                  your pieces while we match this payment against our account — usually within a few
                  hours. You'll get an email the moment it's confirmed, and another if we can't find
                  it. Nothing is dispatched before then.
                </p>
              </>
            ) : (
              <p className="text-sm text-charcoal/60">
                Online payment isn't set up yet — please choose Cash on Delivery, or contact us.
              </p>
            )}
          </div>
        )}

        {serverError && (
          <p
            role="alert"
            className="mt-6 border border-[#d8a] bg-[#faefe9] px-4 py-3 text-sm text-[#8a2f2f]"
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
              : "Submit payment for verification"}
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-charcoal/50">
          {effectiveMethod === "online"
            ? "Prices are confirmed on our server. Orders are dispatched only after we verify your payment."
            : "Prices are confirmed on our server at checkout."}
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
