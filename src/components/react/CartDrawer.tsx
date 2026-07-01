import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import {
  $cart,
  $cartOpen,
  $cartSubtotal,
  closeCart,
  removeFromCart,
  setQty,
} from "../../stores/cart";
import { formatINR } from "../../lib/format";
import { site } from "../../config";

/** Slide-over bag. Always mounted (from BaseLayout); shares the cart store. */
export default function CartDrawer() {
  const open = useStore($cartOpen);
  const lines = useStore($cart);
  const subtotal = useStore($cartSubtotal);

  // Lock scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeCart();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const freeShipDelta = site.freeShippingThreshold - subtotal;

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
    >
      {/* Scrim */}
      <div
        onClick={closeCart}
        className={`absolute inset-0 bg-ink/40 transition-opacity duration-500 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-ivory shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b hairline px-6 py-5">
          <h2 className="font-serif text-xl tracking-wide">Your Bag</h2>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Close bag"
            className="flex h-9 w-9 items-center justify-center text-charcoal/70 hover:text-charcoal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-charcoal/60">Your bag is empty.</p>
            <a href="/shop" onClick={closeCart} className="btn btn-outline">
              Browse the collection
            </a>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-charcoal/10 overflow-y-auto px-6">
              {lines.map((l) => (
                <li key={l.slug} className="flex gap-4 py-5">
                  <a href={`/product/${l.slug}`} onClick={closeCart} className="shrink-0">
                    <img
                      src={l.image}
                      alt={l.name}
                      width={72}
                      height={90}
                      className="h-[90px] w-[72px] rounded-[2px] object-cover"
                      loading="lazy"
                    />
                  </a>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-3">
                      <a
                        href={`/product/${l.slug}`}
                        onClick={closeCart}
                        className="font-serif text-[0.98rem] leading-snug"
                      >
                        {l.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => removeFromCart(l.slug)}
                        aria-label={`Remove ${l.name}`}
                        className="text-charcoal/40 hover:text-charcoal"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-charcoal/60">{formatINR(l.price)}</p>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <QtyStepper
                        qty={l.qty}
                        onChange={(q) => setQty(l.slug, q)}
                        label={l.name}
                      />
                      <span className="text-sm font-medium">
                        {formatINR(l.price * l.qty)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="border-t hairline px-6 py-5">
              {freeShipDelta > 0 ? (
                <p className="mb-3 text-center text-xs text-charcoal/60">
                  Add {formatINR(freeShipDelta)} more for free shipping.
                </p>
              ) : (
                <p className="mb-3 text-center text-xs text-champagne">
                  You've unlocked free shipping.
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm uppercase tracking-[0.14em] text-charcoal/60">
                  Subtotal
                </span>
                <span className="font-serif text-xl">{formatINR(subtotal)}</span>
              </div>
              {site.showGstNote && (
                <p className="mt-1 text-right text-[11px] text-charcoal/45">
                  {site.gstNote}
                </p>
              )}
              <a
                href="/checkout"
                onClick={closeCart}
                className="btn btn-primary mt-4 w-full"
              >
                Checkout
              </a>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function QtyStepper({
  qty,
  onChange,
  label,
}: {
  qty: number;
  onChange: (q: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center border hairline">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={`Decrease ${label} quantity`}
        className="flex h-8 w-8 items-center justify-center text-charcoal/70 hover:text-charcoal"
      >
        –
      </button>
      <span className="w-8 text-center text-sm" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label={`Increase ${label} quantity`}
        className="flex h-8 w-8 items-center justify-center text-charcoal/70 hover:text-charcoal"
      >
        +
      </button>
    </div>
  );
}
