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
  :root{--ivory:#f6f2ea;--bone:#efe7da;--sand:#e2d5c0;--char:#2b2724;--ink:#191512;--gold:#b8893f;--gold-soft:#d9b988;--line:rgba(43,39,36,.12);--shadow:0 1px 2px rgba(43,39,36,.05),0 8px 24px -16px rgba(43,39,36,.25)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ivory);background-image:radial-gradient(48rem 30rem at 100% -8%,rgba(184,137,63,.07),transparent 60%);color:var(--char);font:15px/1.55 -apple-system,Segoe UI,Roboto,system-ui,sans-serif}
  a{color:var(--gold)}
  header.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.9);backdrop-filter:blur(8px)}
  header.top .brand{font-family:Georgia,serif;font-size:19px;letter-spacing:.18em;background:linear-gradient(120deg,#8a6431,#b8893f 45%,#e6c58e 60%,#b8893f);-webkit-background-clip:text;background-clip:text;color:transparent}
  header.top nav{display:flex;align-items:center;flex-wrap:wrap;gap:2px}
  header.top nav a{padding:7px 12px;border-radius:7px;text-decoration:none;font-size:12.5px;text-transform:uppercase;letter-spacing:.09em;color:rgba(43,39,36,.72);transition:background .18s,color .18s}
  header.top nav a:hover{background:var(--bone);color:var(--ink)}
  main{max-width:1100px;margin:0 auto;padding:30px 24px 72px}
  h1{font-family:Georgia,serif;font-weight:400;font-size:29px;margin:0 0 4px;letter-spacing:-.01em}
  h2{font-family:Georgia,serif;font-weight:400}
  .muted{color:rgba(43,39,36,.58)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:24px 0}
  .stat{background:#fff;border:1px solid var(--line);padding:18px 20px;border-radius:10px;box-shadow:var(--shadow)}
  .stat .label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:rgba(43,39,36,.55)}
  .stat .value{font-family:Georgia,serif;font-size:26px;margin-top:6px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
  .filters a{padding:7px 14px;border:1px solid var(--line);border-radius:99px;text-decoration:none;color:var(--char);font-size:12px;text-transform:uppercase;letter-spacing:.08em;background:#fff;transition:all .18s}
  .filters a:hover{border-color:var(--gold)}
  .filters a.active{background:var(--char);color:var(--ivory);border-color:var(--char)}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
  th,td{text-align:left;padding:12px 15px;border-bottom:1px solid rgba(43,39,36,.07);font-size:13.5px;vertical-align:top}
  th{background:var(--bone);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(43,39,36,.6)}
  tbody tr{transition:background .12s}
  tbody tr:hover{background:rgba(184,137,63,.04)}
  tr:last-child td{border-bottom:0}
  .badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  .s-paid{background:#e4f0e6;color:#2f6b3a}
  .s-cod_pending{background:#f3ecd7;color:#8a6d1e}
  .s-pending{background:#eee;color:#666}
  .s-shipped{background:#e2eaf3;color:#2f4d78}
  .s-delivered{background:#dbeadf;color:#276b3a}
  .s-cancelled,.s-failed{background:#f3dede;color:#8a2f2f}
  select,input,textarea,button{font:inherit}
  select{padding:8px 10px;border:1px solid rgba(43,39,36,.2);border-radius:7px;background:#fff}
  input,textarea{border-radius:7px}
  :where(input,textarea,select):focus-visible{outline:2px solid var(--gold-soft);outline-offset:1px}
  button{cursor:pointer;background:var(--char);color:var(--ivory);border:0;padding:9px 15px;border-radius:8px;letter-spacing:.04em;font-weight:500;transition:transform .1s,box-shadow .2s,opacity .2s}
  button:hover{box-shadow:0 6px 16px -8px rgba(43,39,36,.5)}
  button:active{transform:translateY(1px)}
  button.link{background:none;color:var(--gold);padding:0;text-transform:none;letter-spacing:0;font-weight:400;box-shadow:none}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:26px;max-width:420px;margin:8vh auto;box-shadow:var(--shadow)}
  .card h1{font-size:22px}
  .field{margin:16px 0}
  .field label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:rgba(43,39,36,.6);margin-bottom:6px}
  .field input{width:100%;padding:10px 12px;border:1px solid rgba(43,39,36,.22);border-radius:7px}
  .err{background:#f7e0e0;color:#8a2f2f;padding:11px 13px;border-radius:8px;font-size:13px;margin:12px 0}
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
          <a href="/admin/products">Products</a>
          <a href="/admin/content">Homepage</a>
          <a href="/admin/coupons">Coupons</a>
          <a href="/admin/customers">Customers</a>
          <a href="/admin/settings">Settings</a>
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
