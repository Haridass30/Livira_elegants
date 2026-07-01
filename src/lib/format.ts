/** Indian Rupee + number formatting helpers (₹12,499 style). */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Format whole rupees as ₹12,499 (Indian digit grouping, no paise). */
export function formatINR(rupees: number): string {
  return inr.format(rupees);
}

/** Razorpay works in paise. ₹1 = 100 paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
