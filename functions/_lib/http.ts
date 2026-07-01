/** Small JSON response helpers shared by the order Functions. */

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function badRequest(errors: string[] | string) {
  return json(
    { ok: false, errors: Array.isArray(errors) ? errors : [errors] },
    400,
  );
}

export function serverError(message = "Internal error") {
  return json({ ok: false, error: message }, 500);
}
