// WSRS Listening Sessions Notes — API (Cloudflare Pages Function)
//
// One file handles every /api/* route. Same origin as the static site, so the
// session lives in an HttpOnly cookie and there is no CORS.
//
// Phase 1 implements: POST /api/login, POST /api/logout, GET /api/me.
// Phase 2 adds the /api/sessions CRUD routes.
// Phase 4 adds GET /api/versions — the tiny endpoint the session page polls.
// Phase 5 adds GET /api/export — download every session as Markdown or JSON,
//   the escape hatch so Cloudflare is not a single point of failure.

const COOKIE_NAME = "wsrs_session";
const SESSION_TTL_SECONDS = 7776000; // 90 days
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

// Allowed enum values — the client's copy is never trusted.
const DATE_STATUSES = ["none", "rough", "pencilled", "confirmed"];
const STATUSES = ["idea", "firming_up", "well_formed", "ready", "archived"];
const SESSION_TYPES = ["tbc", "listening", "learning"];
const TITLE_MAX = 500;
const NOTES_MAX_BYTES = 200 * 1024;

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

    // The polling endpoint: tiny list of {id, version, updated_at, updated_by}.
    if (path === "/api/versions" && method === "GET") {
      const auth = await readSession(request, env);
      if (!auth) return json({ error: "Not signed in" }, 401);
      if (!env.DB) return json({ error: "Database is not configured" }, 503);
      return await listVersions(env);
    }

    // Full backup download — every session, active and archived.
    if (path === "/api/export" && method === "GET") {
      const auth = await readSession(request, env);
      if (!auth) return json({ error: "Not signed in" }, 401);
      if (!env.DB) return json({ error: "Database is not configured" }, 503);
      return await exportAll(request, env);
    }

    // Everything under /api/sessions requires a valid session.
    const sessionsMatch = path.match(
      /^\/api\/sessions(?:\/([A-Za-z0-9-]+))?$/
    );
    if (sessionsMatch) {
      const auth = await readSession(request, env);
      if (!auth) return json({ error: "Not signed in" }, 401);
      if (!env.DB) return json({ error: "Database is not configured" }, 503);

      const id = sessionsMatch[1];
      if (!id) {
        if (method === "GET") return await listSessions(request, env);
        if (method === "POST") return await createSession(request, env, auth);
        return json({ error: "Method not allowed" }, 405);
      }
      if (method === "GET") return await getSessionRecord(env, id);
      if (method === "PUT") return await updateSession(request, env, auth, id);
      if (method === "DELETE") return await deleteSession(env, id);
      return json({ error: "Method not allowed" }, 405);
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
// Sessions CRUD (Phase 2)
// ---------------------------------------------------------------------------

// Columns returned by the index — deliberately no notes_md, to keep it small.
const LIST_COLUMNS =
  "id, title, date_text, date_status, status, session_type, updated_at, updated_by, version";

async function listSessions(request, env) {
  const url = new URL(request.url);
  const archived = url.searchParams.get("archived") === "1";
  const comparison = archived ? "=" : "!=";
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM sessions
     WHERE status ${comparison} 'archived'
     ORDER BY updated_at DESC`
  ).all();
  return json(results || []);
}

// Deliberately small: the session page fetches this every 15 s to notice a
// change the other person made. No notes_md, no titles — just versions.
async function listVersions(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, version, updated_at, updated_by FROM sessions"
  ).all();
  return json(results || []);
}

// ---------------------------------------------------------------------------
// Export (Phase 5) — the escape hatch: pull everything out in one download.
// ---------------------------------------------------------------------------

// Human-readable labels for the two enums. Kept in step with public/js/labels.js.
const DATE_STATUS_LABELS = {
  none: "Not set",
  rough: "Vague",
  pencilled: "Pencilled in",
  confirmed: "Confirmed",
};
const STATUS_LABELS = {
  idea: "Idea",
  firming_up: "Firming up",
  well_formed: "Well formed",
  ready: "Ready",
  archived: "Archived",
};
const SESSION_TYPE_LABELS = {
  tbc: "To be confirmed",
  listening: "Listening session",
  learning: "Learning session",
};

async function exportAll(request, env) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "md").toLowerCase();

  const { results } = await env.DB.prepare(
    "SELECT * FROM sessions ORDER BY created_at ASC"
  ).all();
  const rows = results || [];

  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const disposition = (ext) =>
    `attachment; filename="wsrs-notes-${stamp}.${ext}"`;

  if (format === "json") {
    const payload = {
      exported_at: new Date().toISOString(),
      count: rows.length,
      sessions: rows,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": disposition("json"),
        "cache-control": "no-store",
      },
    });
  }

  return new Response(exportMarkdown(rows), {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": disposition("md"),
      "cache-control": "no-store",
    },
  });
}

function exportMarkdown(rows) {
  const active = rows.filter((r) => r.status !== "archived").length;
  const archived = rows.length - active;
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);

  const out = [];
  out.push("# WSRS Listening Sessions Notes — full export");
  out.push("");
  out.push(
    `Exported ${now} UTC · ${rows.length} session${rows.length === 1 ? "" : "s"}` +
      ` (${active} active, ${archived} archived)`
  );
  out.push("");
  out.push(
    "Plain-text backup of every session in the database. To rebuild from this " +
      'file see "Restoring from an export" in README.md.'
  );

  rows.forEach((r, i) => {
    const edited = r.updated_at
      ? r.updated_at.replace("T", " ").slice(0, 16) + " UTC"
      : "—";
    const created = r.created_at
      ? r.created_at.replace("T", " ").slice(0, 16) + " UTC"
      : "—";
    out.push("");
    out.push("---");
    out.push("");
    const heading = r.title ? r.title.replace(/\r?\n/g, " ").trim() : "";
    out.push(`## ${i + 1}. ${heading || "Untitled session"}`);
    out.push("");
    out.push("| Field | Value |");
    out.push("| --- | --- |");
    out.push(`| Session status | ${STATUS_LABELS[r.status] || r.status} |`);
    out.push(
      `| Type | ${SESSION_TYPE_LABELS[r.session_type] || r.session_type} |`
    );
    out.push(`| Date | ${mdCell(r.date_text) || "—"} |`);
    out.push(
      `| Date status | ${DATE_STATUS_LABELS[r.date_status] || r.date_status} |`
    );
    out.push(`| Last edited | ${edited}${r.updated_by ? " by " + mdCell(r.updated_by) : ""} |`);
    out.push(`| Created | ${created} |`);
    out.push(`| Version | ${r.version} |`);
    out.push(`| ID | ${r.id} |`);
    out.push("");
    out.push(r.notes_md && r.notes_md.trim() ? r.notes_md.replace(/\s+$/, "") : "_(no notes)_");
  });

  out.push("");
  return out.join("\n");
}

// Keep a value on one Markdown table row: escape pipes, flatten newlines.
function mdCell(value) {
  return String(value == null ? "" : value)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

async function createSession(request, env, auth) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  let title = body && typeof body.title === "string" ? body.title.trim() : "";
  if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sessions
       (id, title, date_text, date_status, status, session_type, notes_md,
        version, updated_at, updated_by, created_at)
     VALUES (?, ?, '', 'none', 'idea', 'tbc', '', 1, ?, ?, ?)`
  )
    .bind(id, title, now, auth.u, now)
    .run();

  return json(await rowById(env, id), 201);
}

async function getSessionRecord(env, id) {
  const row = await rowById(env, id);
  if (!row) return json({ error: "Session not found" }, 404);
  return json(row);
}

async function updateSession(request, env, auth, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid request body" }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const dateText =
    typeof body.date_text === "string" ? body.date_text.trim() : "";
  const dateStatus = body.date_status;
  const status = body.status;
  const sessionType = body.session_type;
  const notesMd = typeof body.notes_md === "string" ? body.notes_md : "";
  const version = body.version;

  // Server-side validation — mandatory. Never trust the client's copy.
  if (title.length > TITLE_MAX) {
    return json({ error: "Title is too long" }, 400);
  }
  if (!DATE_STATUSES.includes(dateStatus)) {
    return json({ error: "Invalid date status" }, 400);
  }
  if (!STATUSES.includes(status)) {
    return json({ error: "Invalid session status" }, 400);
  }
  if (!SESSION_TYPES.includes(sessionType)) {
    return json({ error: "Invalid session type" }, 400);
  }
  if (byteLength(notesMd) > NOTES_MAX_BYTES) {
    return json({ error: "Notes are too large (200 KB limit)" }, 413);
  }
  if (!Number.isInteger(version)) {
    return json({ error: "Missing version" }, 400);
  }

  const existing = await rowById(env, id);
  if (!existing) return json({ error: "Session not found" }, 404);

  const now = new Date().toISOString();
  const nextVersion = existing.version + 1;

  // Atomic compare-and-set: the WHERE clause guards the version so two
  // concurrent writers cannot both succeed.
  const result = await env.DB.prepare(
    `UPDATE sessions
        SET title = ?, date_text = ?, date_status = ?, status = ?,
            session_type = ?, notes_md = ?, version = ?, updated_at = ?,
            updated_by = ?
      WHERE id = ? AND version = ?`
  )
    .bind(
      title,
      dateText,
      dateStatus,
      status,
      sessionType,
      notesMd,
      nextVersion,
      now,
      auth.u,
      id,
      version
    )
    .run();

  if (!result.meta || result.meta.changes === 0) {
    // Version moved under us — return the current server record (with its
    // notes_md) so the client can offer the three-way non-destructive choice.
    return json({ error: "Conflict", current: existing }, 409);
  }

  return json(await rowById(env, id));
}

async function deleteSession(env, id) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

async function rowById(env, id) {
  return await env.DB.prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(id)
    .first();
}

function byteLength(str) {
  return new TextEncoder().encode(str).length;
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
