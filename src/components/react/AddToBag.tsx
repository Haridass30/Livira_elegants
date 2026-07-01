import { useState } from "react";
import { addToCart } from "../../stores/cart";
import type { CartLine } from "../../lib/types";

interface Props {
  product: Omit<CartLine, "qty">;
  inStock: boolean;
}

/** Product-page "Add to bag" island with a small quantity selector. */
export default function AddToBag({ product, inStock }: Props) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (!inStock) {
    return (
      <button type="button" disabled className="btn btn-primary w-full">
        Sold out
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex items-center justify-between border hairline sm:w-32">
        <button
          type="button"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          aria-label="Decrease quantity"
          className="flex h-12 w-12 items-center justify-center text-lg text-charcoal/70 hover:text-charcoal"
        >
          –
        </button>
        <span className="text-sm" aria-live="polite">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => setQty((q) => Math.min(20, q + 1))}
          aria-label="Increase quantity"
          className="flex h-12 w-12 items-center justify-center text-lg text-charcoal/70 hover:text-charcoal"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          addToCart(product, qty);
          setAdded(true);
          setTimeout(() => setAdded(false), 1600);
        }}
        className="btn btn-primary flex-1"
      >
        {added ? "Added ✓" : "Add to bag"}
      </button>
    </div>
  );
}
