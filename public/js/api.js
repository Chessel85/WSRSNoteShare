// Fetch wrappers for the WSRS Notes API.
//
// Every call is same-origin and sends the session cookie automatically.
// A 401 from any call means "not signed in" — callers handle that by showing
// the login view.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: {},
    credentials: "same-origin",
  };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (networkErr) {
    throw new ApiError("Network error — you may be offline", 0, null);
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const msg =
      (parsed && parsed.error) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, parsed);
  }
  return parsed;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),

  // Named helpers
  me: () => request("GET", "/api/me"),
  login: (passphrase) => request("POST", "/api/login", { passphrase }),
  logout: () => request("POST", "/api/logout"),

  listSessions: (archived = false) =>
    request("GET", `/api/sessions?archived=${archived ? 1 : 0}`),
  getSession: (id) =>
    request("GET", `/api/sessions/${encodeURIComponent(id)}`),
  createSession: (title) =>
    request("POST", "/api/sessions", { title: title || "" }),
  updateSession: (id, data) =>
    request("PUT", `/api/sessions/${encodeURIComponent(id)}`, data),
  deleteSession: (id) =>
    request("DELETE", `/api/sessions/${encodeURIComponent(id)}`),

  // Phase 4: the polling endpoint — [{id, version, updated_at, updated_by}].
  versions: () => request("GET", "/api/versions"),
};
