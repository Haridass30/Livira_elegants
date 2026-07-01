/** Shared types across the storefront, islands and order Functions. */

export type CheckoutMethod = "online" | "cod";

export type OrderStatus =
  | "pending"
  | "paid"
  | "cod_pending"
  | "failed"
  | "cancelled";

/** What the cart island keeps in localStorage (display only — never trusted). */
export interface CartLine {
  slug: string;
  name: string;
  /** Display price in rupees; the server re-derives the real price. */
  price: number;
  /** Optimised thumbnail URL for the drawer. */
  image: string;
  qty: number;
}

/** The only cart data the server actually relies on. */
export interface OrderItemInput {
  slug: string;
  qty: number;
}

export interface CustomerInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
}

export interface CreateOrderRequest {
  items: OrderItemInput[];
  customer: CustomerInput;
  method: CheckoutMethod;
}

export interface VerifyOrderRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** A line after server-side recomputation from canonical catalogue data. */
export interface PricedLine {
  slug: string;
  name: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  sku?: string;
}

export interface OrderTotals {
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
}
