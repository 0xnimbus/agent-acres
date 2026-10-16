// Sign-in gate for the hosted station, run by Vercel before any file is served.
// You sign in with your email: the login page emails a one-time link to the single
// allowed address, and opening it keeps that browser signed in for 30 days.
// Agents and hooks skip the gate only for POST /api/events, and only with the
// AGENT_ACRES_TOKEN bearer token.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   ALLOWED_EMAIL      the one address allowed in (your Claude email)
//   RESEND_API_KEY     Resend key used to send the sign-in email
//   MAIL_FROM          a sender on a domain verified in Resend, e.g. "Agent Acres <login@yourdomain.com>"
//   SESSION_SECRET     random string, 32+ characters, signs links and cookies
//   AGENT_ACRES_TOKEN  random string agents send when reporting events
// If anything is missing the site refuses every request instead of opening up.

export const config = { matcher: "/:path*" };

const COOKIE = "acres_session";
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;
const enc = new TextEncoder();

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Compares two strings without leaking where they differ, by comparing their HMACs.
async function safeEqual(a, b, secret) {
  const [x, y] = await Promise.all([hmac(secret, "cmp:" + a), hmac(secret, "cmp:" + b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// "<expiry ms>.<signature>", bound to the allowed email: changing it or SESSION_SECRET signs everyone out.
async function signed(kind, secret, email, ms) {
  const exp = Date.now() + ms;
  return exp + "." + (await hmac(secret, kind + ":" + email + ":" + exp));
}
async function verify(kind, value, secret, email) {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secret, kind + ":" + email + ":" + exp), secret);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

function mask(email) {
  const [u, d] = email.split("@");
  return (u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "*".repeat(Math.max(1, u.length - 2))) + "@" + d;
}

function page(email, message, sent, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Agent Acres</title><meta name="robots" content="noindex,nofollow">
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050816;color:#e6ecff;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
form{background:#0a1130;border:1px solid #22336e;border-radius:12px;padding:24px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px;box-shadow:0 0 24px rgba(61,107,255,.25)}
h1{font-size:20px;margin:0;color:#7fa4ff;letter-spacing:1px}p{margin:0;color:#8191c4;font-size:14px}
button{font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:#7aa2ff;color:#050816;cursor:pointer}
.ok{color:#7ee08a}.err{color:#ff6b6b}
</style></head><body>
<form method="post" action="/login">
<h1>AGENT ACRES</h1>
<p>Sign in with your email. We'll send a one-time link to <b>${mask(email)}</b>.</p>
${message ? `<p class="${sent ? "ok" : "err"}" role="alert">${message}</p>` : ""}
<button type="submit">${sent ? "Send another link" : "Email me a sign-in link"}</button>
</form></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function redirect(to, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...extraHeaders } });
}

async function sendLink(env, link) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.resend, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.from,
      to: [env.email],
      subject: "Your Agent Acres sign-in link",
      text: `Open this link to sign in to Agent Acres (it works for ${LINK_MINUTES} minutes):\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
      html: `<p>Open this link to sign in to Agent Acres (it works for ${LINK_MINUTES} minutes):</p><p><a href="${link}">Sign in to Agent Acres</a></p><p style="color:#888">If you didn't ask for this, ignore this email.</p>`,
    }),
  });
  return r.ok;
}

export default async function middleware(request) {
  const env = {
    email: (process.env.ALLOWED_EMAIL || "").trim().toLowerCase(),
    resend: (process.env.RESEND_API_KEY || "").trim(),
    from: (process.env.MAIL_FROM || "").trim(),
    secret: (process.env.SESSION_SECRET || "").trim(),
    token: (process.env.AGENT_ACRES_TOKEN || "").trim(),
  };
  if (!env.email || !env.resend || !env.from || env.secret.length < 32) {
    return new Response("This site isn't configured yet: set ALLOWED_EMAIL, RESEND_API_KEY, MAIL_FROM and a SESSION_SECRET of at least 32 characters in Vercel.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  if (env.token && url.pathname === "/api/events" && request.method === "POST") {
    const auth = request.headers.get("authorization") || "";
    if (await safeEqual(auth, "Bearer " + env.token, env.secret)) return; // the function checks it again
    return new Response(JSON.stringify({ ok: false, error: "missing or wrong token" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const sessionOk = () => verify("session", readCookie(request, COOKIE), env.secret, env.email);

  if (url.pathname === "/logout") {
    return redirect("/login", { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` });
  }

  // The emailed link lands here.
  if (url.pathname === "/auth") {
    if (await verify("link", url.searchParams.get("t") || "", env.secret, env.email)) {
      const value = await signed("session", env.secret, env.email, SESSION_DAYS * 86400000);
      return redirect("/", { "Set-Cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}` });
    }
    return page(env.email, "That link has expired or isn't valid. Send yourself a new one.", false, 401);
  }

  if (url.pathname === "/login") {
    if (request.method === "POST") {
      // Block login forms posted from other sites.
      const site = request.headers.get("sec-fetch-site");
      const origin = request.headers.get("origin");
      const crossSite = site ? !["same-origin", "none"].includes(site) : (origin && origin !== "null" && origin !== url.origin);
      if (crossSite) return new Response("Forbidden", { status: 403 });
      const link = url.origin + "/auth?t=" + encodeURIComponent(await signed("link", env.secret, env.email, LINK_MINUTES * 60000));
      const ok = await sendLink(env, link);
      return ok
        ? page(env.email, "Sent. Check your inbox and open the link on this device.", true)
        : page(env.email, "The email couldn't be sent. Check RESEND_API_KEY and MAIL_FROM in Vercel.", false, 502);
    }
    if (await sessionOk()) return redirect("/");
    return page(env.email, "", false);
  }

  if (await sessionOk()) return; // continue to the file

  const accept = request.headers.get("accept") || "";
  if (request.method === "GET" && accept.includes("text/html")) return redirect("/login");
  return new Response("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });
}
