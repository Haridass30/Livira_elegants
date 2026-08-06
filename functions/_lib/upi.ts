/**
 * UPI reference (UTR / RRN) handling for the manual online-payment flow.
 *
 * IMPORTANT — what this can and cannot do. There is no public API (NPCI, banks
 * or otherwise) to look up a UPI transaction id, so nothing here proves money
 * arrived; only the owner checking their bank/UPI app can do that. What these
 * checks do is make the reference *usable evidence*: the value must have the
 * shape of a real UTR, and it can only ever be claimed by one order, so the
 * obvious fakes (typing 12 random-looking digits, re-sending a friend's
 * reference, replaying your own from a previous order) never reach the queue.
 */

/** A bank UTR/RRN as shown in every UPI app: exactly 12 digits. */
const UTR_LENGTH = 12;

/** Strip the spaces/dashes people paste in and keep the digits. */
export function normaliseUpiRef(raw: string): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

/** All one digit: 000000000000, 111111111111 … */
function isRepeated(ref: string): boolean {
  return /^(\d)\1+$/.test(ref);
}

/** A straight run in either direction: 123456789012, 987654321098 … */
function isSequential(ref: string): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < ref.length; i++) {
    const step = Number(ref[i]) - Number(ref[i - 1]);
    // Wrap 9→0 (and 0→9) so 890123… still counts as a run.
    if (step !== 1 && step !== -9) up = false;
    if (step !== -1 && step !== 9) down = false;
  }
  return up || down;
}

/** A short pattern typed over and over: 121212121212, 123412341234 … */
function isRepeatedBlock(ref: string): boolean {
  for (const size of [2, 3, 4, 6]) {
    const block = ref.slice(0, size);
    if (ref === block.repeat(ref.length / size)) return true;
  }
  return false;
}

export interface UpiRefCheck {
  ok: boolean;
  /** The normalised value to store (digits only). */
  ref: string;
  reason?: string;
}

/**
 * Shape-check a customer-entered reference. Rejects everything that cannot be
 * a bank UTR, plus the filler patterns people reach for when inventing one.
 */
export function checkUpiRef(raw: string): UpiRefCheck {
  const ref = normaliseUpiRef(raw);

  if (!ref) {
    return { ok: false, ref, reason: "Please enter the UPI reference (UTR) from your payment app." };
  }
  if (ref.length !== UTR_LENGTH) {
    return {
      ok: false,
      ref,
      reason:
        `A UPI reference is exactly ${UTR_LENGTH} digits — you entered ${ref.length}. ` +
        "Open the payment in your UPI app and copy the UTR / transaction reference.",
    };
  }
  if (isRepeated(ref) || isSequential(ref) || isRepeatedBlock(ref)) {
    return {
      ok: false,
      ref,
      reason: "That isn't a valid UPI reference. Please copy the exact UTR shown in your payment app.",
    };
  }
  return { ok: true, ref };
}

/** Display form used in emails and the admin queue: 1234 5678 9012. */
export function formatUpiRef(ref: string): string {
  return ref.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/* ------------------------------------------------------------------ *
 * Payment screenshot ("proof") sent as a data: URL from the checkout.
 * The island downscales before upload; these are the server-side limits.
 * ------------------------------------------------------------------ */

const PROOF_MAX_BYTES = 1_200_000;
const PROOF_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface DecodedProof {
  ok: boolean;
  mime: string;
  bytes: ArrayBuffer | null;
  reason?: string;
}

export function decodePaymentProof(dataUrl: string): DecodedProof {
  const fail = (reason: string): DecodedProof => ({ ok: false, mime: "", bytes: null, reason });
  const m = /^data:([a-z/+-]+);base64,(.+)$/i.exec(String(dataUrl ?? "").trim());
  if (!m) return fail("The payment screenshot could not be read. Please attach it again.");

  const mime = m[1].toLowerCase();
  if (!PROOF_MIMES.has(mime)) return fail("Please attach a JPG, PNG or WebP screenshot.");

  let binary: string;
  try {
    binary = atob(m[2]);
  } catch {
    return fail("The payment screenshot could not be read. Please attach it again.");
  }
  if (binary.length > PROOF_MAX_BYTES) {
    return fail("That screenshot is too large — please attach one under 1 MB.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, mime, bytes: bytes.buffer };
}
