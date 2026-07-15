import { useStore } from "@nanostores/react";
import { $cartCount, openCart } from "../../stores/cart";

/** Header cart trigger with a live item-count badge. */
export default function CartButton() {
  const count = useStore($cartCount);
  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={`Open bag${count ? `, ${count} item${count > 1 ? "s" : ""}` : ""}`}
      className="relative flex h-10 w-10 items-center justify-center text-charcoal"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 2 3 6.5V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5L18 2H6Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M3 6.5h18" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M16 10a4 4 0 0 1-8 0"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      {count > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-champagne px-1 text-[10px] font-semibold text-ivory"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}
