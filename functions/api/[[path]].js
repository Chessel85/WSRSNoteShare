// WSRS Listening Sessions Notes — API (Cloudflare Pages Function)
//
// One file handles every /api/* route. Same origin as the static site, so the
// session lives in an HttpOnly cookie and there is no CORS.
//
// Phase 1 implements: POST /api/login, POST /api/logout, GET /api/me.
// Later phases add the /api/sessions routes.

const COOKIE_NAME = "wsrs_session";
const SESSION_TTL_SECONDS = 7776000; // 90 days
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, ""); // strip trailing slash
  const method = request.method.toUpperCase();

  try {
    if (path === "/api/login" && method === "POST") {
      return await handleLogin(request, env);
    }
    if (path === "/api/logout" && method === "POST") {
      return handleLogout();
    }
    if (path === "/api/me" && method === "GET") {
      return await handleMe(request, env);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    // Never leak internals; log for the owner.
    console.error("API error:", err && err.stack ? err.stack : err);
    return json({ error: "Something went wrong" }, 500);
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleLogin(request, env) {
  const ip = clientIp(request);

  if (await rateLimited(env, ip)) {
    return json(
      { error: "Too many attempts. Wait 15 minutes and try again." },
      429
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const passphrase =
    body && typeof body.passphrase === "string" ? body.passphrase : "";

  const user = await matchPassphrase(passphrase, env);

  if (!user) {
    await recordFailedAttempt(env, ip);
    // Generic message — never reveal which passphrase was close.
    return json({ error: "Incorrect passphrase" }, 401);
  }

  const cookie = await makeSessionCookie(user, env);
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": cookie,
      "cache-control": "no-store",
    },
  });
}

function handleLogout() {
  const expired = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": expired, "cache-control": "no-store" },
  });
}

async function handleMe(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ error: "Not signed in" }, 401);
  return json({ user: session.u }, 200);
}

// ---------------------------------------------------------------------------
// Passphrase check (constant-time, digest comparison)
// ---------------------------------------------------------------------------

async function matchPassphrase(candidate, env) {
  const pairs = [
    { secret: env.PASSPHRASE_A, user: "A" },
    { secret: env.PASSPHRASE_B, user: "B" },
  ];
  const candidateDigest = await sha256(candidate);

  let matched = null;
  // Check every entry regardless of an early match so timing does not vary.
  for (const { secret, user } of pairs) {
    if (typeof secret !== "string" || secret.length === 0) continue;
    const secretDigest = await sha256(secret);
    if (timingSafeEqual(candidateDigest, secretDigest)) {
      matched = displayNameFor(user, env);
    }
  }
  return matched;
}

function displayNameFor(slot, env) {
  // Optional NAME_A / NAME_B secrets give a friendly attribution label.
  const configured = slot === "A" ? env.NAME_A : env.NAME_B;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return slot === "A" ? "Owner" : "Friend";
}

// ---------------------------------------------------------------------------
// Signed session cookie:  base64url(payload).base64url(HMAC-SHA256(payload))
// ---------------------------------------------------------------------------

async function makeSessionCookie(user, env) {
  const payload = {
    u: user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signToken(payload, env.SESSION_SECRET);
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join("; ");
}

async function signToken(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(payloadB64, secret);
  return `${payloadB64}.${base64urlEncode(sig)}`;
}

async function readSession(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token || !env.SESSION_SECRET) return null;

  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = await hmacSha256(payloadB64, env.SESSION_SECRET);
  let givenSig;
  try {
    givenSig = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(new Uint8Array(expectedSig), givenSig)) return null;

  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64))
    );
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.u !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Login rate limiting (D1)
// ---------------------------------------------------------------------------

function currentWindowStart() {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % RATE_LIMIT_WINDOW_SECONDS);
}

async function rateLimited(env, ip) {
  if (!env.DB) return false; // fail open only if the DB is unbound (setup)
  const windowStart = currentWindowStart();
  const row = await env.DB.prepare(
    "SELECT count FROM login_attempts WHERE ip = ? AND window_start = ?"
  )
    .bind(ip, windowStart)
    .first();
  return !!row && row.count >= RATE_LIMIT_MAX;
}

async function recordFailedAttempt(env, ip) {
  if (!env.DB) return;
  const windowStart = currentWindowStart();
  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(ip, window_start)
     DO UPDATE SET count = count + 1`
  )
    .bind(ip, windowStart)
    .run();
  // Opportunistic cleanup of old buckets.
  await env.DB.prepare(
    "DELETE FROM login_attempts WHERE window_start < ?"
  )
    .bind(windowStart - RATE_LIMIT_WINDOW_SECONDS * 4)
    .run();
}

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto)
// ---------------------------------------------------------------------------

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return new Uint8Array(sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function base64urlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  );
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Exported for later phases / tests.
export { readSession, json };
