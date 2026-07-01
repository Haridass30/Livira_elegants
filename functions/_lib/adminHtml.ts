/** Server-rendered HTML helpers for the /admin area (no client framework). */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape untrusted values before interpolating into HTML. */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

export function money(rupees: number): string {
  return `₹${Number(rupees || 0).toLocaleString("en-IN")}`;
}

export function htmlResponse(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

/** Shared page chrome — brand palette, minimal CSS, no JS dependencies. */
export function adminPage(opts: {
  title: string;
  body: string;
  authed?: boolean;
}): string {
  const { title, body, authed = true } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(title)} · Livira Admin</title>
<style>
  :root{--ivory:#f8f4ed;--bone:#efe7da;--sand:#e2d5c0;--char:#2b2724;--ink:#191512;--gold:#b8893f}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ivory);color:var(--char);font:15px/1.5 -apple-system,Segoe UI,Roboto,system-ui,sans-serif}
  a{color:var(--gold)}
  header.top{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid rgba(43,39,36,.12);background:#fff}
  header.top .brand{font-family:Georgia,serif;font-size:20px;letter-spacing:.16em}
  header.top nav a{margin-left:18px;text-decoration:none;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--char)}
  main{max-width:1100px;margin:0 auto;padding:28px 24px 60px}
  h1{font-family:Georgia,serif;font-weight:400;font-size:28px;margin:0 0 4px}
  .muted{color:rgba(43,39,36,.6)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:24px 0}
  .stat{background:#fff;border:1px solid rgba(43,39,36,.1);padding:18px 20px;border-radius:3px}
  .stat .label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:rgba(43,39,36,.55)}
  .stat .value{font-family:Georgia,serif;font-size:26px;margin-top:6px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
  .filters a{padding:7px 14px;border:1px solid rgba(43,39,36,.18);border-radius:2px;text-decoration:none;color:var(--char);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
  .filters a.active{background:var(--char);color:var(--ivory);border-color:var(--char)}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;overflow:hidden}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid rgba(43,39,36,.08);font-size:13.5px;vertical-align:top}
  th{background:var(--bone);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(43,39,36,.6)}
  tr:last-child td{border-bottom:0}
  .badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  .s-paid{background:#e4f0e6;color:#2f6b3a}
  .s-cod_pending{background:#f3ecd7;color:#8a6d1e}
  .s-pending{background:#eee;color:#666}
  .s-shipped{background:#e2eaf3;color:#2f4d78}
  .s-delivered{background:#dbeadf;color:#276b3a}
  .s-cancelled,.s-failed{background:#f3dede;color:#8a2f2f}
  select,input,button{font:inherit}
  select{padding:6px 8px;border:1px solid rgba(43,39,36,.22);border-radius:2px;background:#fff}
  button{cursor:pointer;background:var(--char);color:var(--ivory);border:0;padding:7px 12px;border-radius:2px;letter-spacing:.04em}
  button.link{background:none;color:var(--gold);padding:0;text-transform:none;letter-spacing:0}
  .card{background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:22px;max-width:420px;margin:8vh auto}
  .card h1{font-size:22px}
  .field{margin:16px 0}
  .field label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:rgba(43,39,36,.6);margin-bottom:6px}
  .field input{width:100%;padding:10px 12px;border:1px solid rgba(43,39,36,.25);border-radius:2px}
  .err{background:#f7e0e0;color:#8a2f2f;padding:10px 12px;border-radius:2px;font-size:13px;margin:12px 0}
  .items{margin:0;padding-left:16px}
  details summary{cursor:pointer;color:var(--gold)}
</style>
</head>
<body>
${
  authed
    ? `<header class="top">
        <span class="brand">LIVIRA · ADMIN</span>
        <nav>
          <a href="/admin">Orders</a>
          <form method="post" action="/admin/logout" style="display:inline">
            <button class="link" type="submit">Log out</button>
          </form>
        </nav>
      </header>`
    : ""
}
<main>${body}</main>
</body>
</html>`;
}
