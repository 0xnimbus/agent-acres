// Password gate for the whole hosted station, run by Vercel before any file is served
// (adapted from JobHunt.ai). Agents and hooks skip it only for POST /api/events, and
// only with the AGENT_ACRES_TOKEN bearer token.
//
// Required environment variables (Vercel → Project → Settings → Environment Variables):
//   APP_PASSWORD    the password you type to get in
//   SESSION_SECRET  a long random string used to sign the login cookie
//   AGENT_ACRES_TOKEN  the token agents send when they report events
// If either is missing the site refuses every request instead of opening up.

export const config = { matcher: "/:path*" };

const COOKIE = "acres_session";
const SESSION_DAYS = 30;
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

// Session cookie value is "<expiry ms>.<signature>". Changing SESSION_SECRET or APP_PASSWORD signs everyone out.
async function makeSession(secret, password) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return exp + "." + (await hmac(secret + password, "session:" + exp));
}

async function validSession(value, secret, password) {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secret + password, "session:" + exp), secret);
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

function loginPage(message, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Agent Acres</title><meta name="robots" content="noindex,nofollow">
<style>
:root{--bg:#000;--card:#0A0A0A;--ink:#EDEDED;--muted:#A1A1A1;--line:#262626;--accent:#EDEDED;--err:#FF5F56;color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(360px,100%);display:flex;flex-direction:column;gap:12px}
h1{font-size:20px;margin:0}p{margin:0;color:var(--muted);font-size:13.5px}
input{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
button{font:inherit;font-weight:600;padding:9px;border:0;border-radius:8px;background:var(--accent);color:#0A0A0A;cursor:pointer}
.err{color:var(--err)}
</style></head><body>
<form method="post" action="/login">
<h1>Agent Acres</h1><p>Enter your password to open the station.</p>
${message ? `<p class="err" role="alert">${message}</p>` : ""}
<input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus>
<button type="submit">Sign in</button>
</form></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function redirect(to, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...extraHeaders } });
}

export default async function middleware(request) {
  const password = (process.env.APP_PASSWORD || "").trim();
  const secret = (process.env.SESSION_SECRET || "").trim();
  if (!password || !secret || secret.length < 32) {
    return new Response("This site isn't configured yet: set APP_PASSWORD and a SESSION_SECRET of at least 32 characters in Vercel.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const token = (process.env.AGENT_ACRES_TOKEN || "").trim();
  if (token && url.pathname === "/api/events" && request.method === "POST") {
    const auth = request.headers.get("authorization") || "";
    if (await safeEqual(auth, "Bearer " + token, secret)) return; // the function checks it again
    return new Response(JSON.stringify({ ok: false, error: "missing or wrong token" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const secure = url.protocol === "https:" ? "; Secure" : "";

  if (url.pathname === "/logout") {
    return redirect("/login", { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}` });
  }

  if (url.pathname === "/login") {
    if (request.method === "POST") {
      // Block login forms posted from other sites. Sec-Fetch-Site is set by every current browser;
      // Origin is the fallback, and is "null" when the page's referrer policy is no-referrer.
      const site = request.headers.get("sec-fetch-site");
      const origin = request.headers.get("origin");
      const crossSite = site ? !["same-origin", "none"].includes(site) : (origin && origin !== "null" && origin !== url.origin);
      if (crossSite) return new Response("Forbidden", { status: 403 });
      let given = "";
      try { given = String((await request.formData()).get("password") || ""); } catch (_) {}
      if (await safeEqual(given, password, secret)) {
        const value = await makeSession(secret, password);
        return redirect("/", { "Set-Cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}` });
      }
      // Slow down guessing.
      await new Promise((r) => setTimeout(r, 1200));
      return loginPage("That password isn't right.", 401);
    }
    if (await validSession(readCookie(request, COOKIE), secret, password)) return redirect("/");
    return loginPage("");
  }

  if (await validSession(readCookie(request, COOKIE), secret, password)) return; // continue to the file

  const accept = request.headers.get("accept") || "";
  if (request.method === "GET" && accept.includes("text/html")) return redirect("/login");
  return new Response("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });
}
