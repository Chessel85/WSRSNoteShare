# Implementation Plan — WSRS Listening Sessions Notes

**Audience:** an AI coding agent (Sonnet) implementing this from scratch, plus the repo owner doing the one-time account setup steps.
**Source requirements:** `requirements.txt` in this folder.
**Primary objective:** a simple, accessible, always-available web page where two people share notes on WSRS Listening Sessions, with a single source of truth.

---

## 0. The one architectural decision everything else follows from

GitHub Pages serves static files. It cannot check a password and it cannot save anything. The notes contain names, emails and phone numbers, so a password checked in client-side JavaScript is unacceptable — anyone can read the source and skip it.

Therefore the system is three parts:

| Part | What it is | Accounts needed |
|---|---|---|
| **Site** | Static HTML/CSS/JS | GitHub repo (owner already has) |
| **API** | One Cloudflare Pages Function holding the passphrase secrets and DB binding | One free Cloudflare account (owner only) |
| **Store** | Cloudflare D1 (SQLite) — the single source of truth | Same free account |

**Hosting decision: deploy the site with Cloudflare Pages, connected to the GitHub repo.**

The repo stays on GitHub and remains the thing you push to — but Cloudflare builds and serves it, which puts the site and the API on the *same origin*. This is not a preference, it is a correctness issue: same-origin lets the login use an `HttpOnly` `Secure` cookie, which cannot be read by script and needs no CORS. If the site were on `github.io` and the API on `workers.dev`, the session cookie would be a third-party cookie — and Safari on macOS (the friend's machine) and Firefox's Total Cookie Protection (the owner's) both actively block those. The login would randomly stop working. Do not build it that way.

*Fallback if Cloudflare Pages is refused:* GitHub Pages + a standalone Worker, session token in `localStorage` sent as an `Authorization: Bearer` header, with strict CORS allow-listing the Pages origin. Works, but is meaningfully weaker (token readable by any injected script) and must be paired with rigorous HTML sanitising. Prefer same-origin.

---

## 1. Authentication design

Two passphrases, not one. Store `PASSPHRASE_A` and `PASSPHRASE_B` as Cloudflare secrets, each mapped to a display name.

Why two: it gives free attribution ("Last edited by Chris, 14:32") without any login accounts, and either person's passphrase can be rotated without disturbing the other. Cost is zero extra effort.

The passphrases are three-word style, e.g. `LionCabbageKingfisher`. **The owner communicates the friend's passphrase to him directly (verbally/privately).** The app therefore needs no invitation flow, no email sending, no password reset, and no user management screen — a deliberate and significant simplification. Rotating a passphrase is an owner action in the Cloudflare dashboard, documented in the README.

Flow:

1. `POST /api/login {passphrase}` — the Function compares against both secrets using a **constant-time** comparison (compare SHA-256 digests byte by byte; never `===` on the raw strings, and never leak which one matched via timing or error text).
2. On success, set a signed session cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000` (90 days). Value is `base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))` where payload is `{"u":"chris","exp":<unix>}`. Verify signature and `exp` on every API request.
3. On failure: generic `401 {"error":"Incorrect passphrase"}`. Never reveal which passphrase was close.
4. **Rate limit login: max 10 attempts per IP per 15 minutes** (a D1 row or KV counter). Without this, a passphrase is brute-forceable at HTTP speed. This is required, not optional — it is the single control that makes a shared passphrase defensible.
5. `POST /api/logout` clears the cookie. Provide a visible "Sign out" control — the friend may use a shared machine.

Everything under `/api/*` except `/api/login` returns `401` without a valid session. The static HTML shell may load unauthenticated (it contains no data); it fetches data and, on `401`, renders the login form.

---

## 2. Data model

D1 schema (`schema.sql`):

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,          -- uuid v4, generated server-side
  title         TEXT NOT NULL DEFAULT '',
  date_text     TEXT NOT NULL DEFAULT '',  -- free text: '', 'March 2026', '14 March 2026'
  date_status   TEXT NOT NULL DEFAULT 'none',
                                           -- none | rough | pencilled | confirmed
  status        TEXT NOT NULL DEFAULT 'idea',
                                           -- idea | firming_up | well_formed | ready | archived
  notes_md      TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,             -- ISO 8601 UTC
  updated_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sessions_status ON sessions(status);
```

Deliberate choices:

- **`date_text` is free text, not a DATE column.** The requirements say the date may be blank, or a month and year only. A real date type would make the common case ("sometime in spring") unrepresentable. Sorting the index by date is therefore best-effort: parse what looks parseable, sort unparseable and blank entries last. Never silently coerce or reformat what the user typed.
- **`version` is an integer incremented on every write.** It powers both conflict detection and change polling. See §4.
- **No separate archive table.** Archiving is `status = 'archived'`; the archive page is a filtered view. One table, one truth.

---

## 3. API contract

All JSON. All require a valid session cookie unless stated.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/api/login` | `{passphrase}` | `{user}` + Set-Cookie, or 401 |
| POST | `/api/logout` | — | 204, clears cookie |
| GET | `/api/me` | — | `{user}` or 401 — used on load to choose login vs app |
| GET | `/api/sessions` | `?archived=0\|1` | `[{id,title,date_text,date_status,status,updated_at,updated_by,version}]` — **no `notes_md`**, keep the index payload small |
| POST | `/api/sessions` | `{title?}` | the new record |
| GET | `/api/sessions/:id` | — | full record including `notes_md` |
| PUT | `/api/sessions/:id` | `{title,date_text,date_status,status,notes_md,version}` | updated record with `version+1`, or **409** plus the current server record |
| DELETE | `/api/sessions/:id` | — | 204; UI must require typed confirmation |
| GET | `/api/versions` | — | `[{id,version,updated_at,updated_by}]` — tiny; the polling endpoint |
| GET | `/api/export` | — | all sessions as one Markdown or JSON download |

**Validation is server-side and mandatory.** Check `date_status` and `status` against the allowed enum values and reject anything else with 400. Never trust the client's copy. Cap `notes_md` at ~200 KB and return 413 above that.

---

## 4. Saving, conflicts, and "real-time"

Most of the project risk lives here. Be precise.

### Saving

The requirement is that notes survive leaving the page. Implement all of these:

1. **Debounced autosave** — 1500 ms after typing stops. This is the real mechanism.
2. **Save on blur** of the editor, and when navigating between pages in the app.
3. **`pagehide` backstop** — `fetch(url, {method:'PUT', body, keepalive:true})`. Use `pagehide`, not `beforeunload`: `beforeunload` cannot reliably await an async request and Safari treats it inconsistently. `keepalive` is capped at 64 KB; above that, skip the backstop and rely on the debounce having already fired.
4. **An explicit "Save now" button** regardless. The requirement names it as the minimum bar and some users simply want it. A real `<button>`, keyboard reachable, announcing its result.
5. **A local draft safety net** — mirror editor content to `localStorage` on each keystroke (cheap, synchronous, survives a crashed tab or dead network). When opening a session, if a local draft is newer than the server copy, offer "Restore unsaved changes from this device?" rather than silently overwriting either side.

**Save status must be announced.** A visible status line that is also an `aria-live="polite"` region, cycling *Unsaved changes* → *Saving…* → *Saved 14:32*. On failure it becomes a `role="alert"` error stating that the notes are still in the box and to press Save now. Never let a save fail silently — with two people sharing notes, a silent failure is the worst possible outcome.

### Conflicts

Every `PUT` sends the `version` the client loaded. If it does not match the DB, return **409** plus the current server record. The client then shows a clear, non-destructive choice: **Keep mine** / **Use theirs** / **Show both** (render side by side, or append theirs under a `## Conflicted copy` heading).

**Never auto-merge and never silently discard.** For two people this will be rare, but when it happens it must not eat anyone's work.

### "Real-time"

True live collaborative typing (CRDT/OT, Durable Objects, WebSockets) is out of proportion to two people on a mini-project. Implement **polling**:

- While a session page is open, `GET /api/versions` every 15 seconds.
- If the open session's version increased and the local editor is **clean**, refresh content in place and announce "Updated by Alex just now" via `aria-live="polite"`.
- If the local editor is **dirty**, do not overwrite. Show a persistent, focusable banner: "Alex has changed this session. Save your changes, then reload to see theirs."
- Pause polling when the tab is hidden (`document.visibilityState`); resume and poll immediately on becoming visible.

This satisfies "see what the other person has done a short time after they have done it without having to refresh" at a fraction of the complexity. A Durable Object WebSocket is a possible later upgrade, not a v1 goal.

---

## 5. The editor — the key accessibility decision

**Recommendation: a plain `<textarea>` containing Markdown, plus a rendered preview. Not a WYSIWYG contenteditable.**

The requirements ask for headings, lists and tables that work with NVDA quick-nav (`H`, `L`, `T`) *and* WYSIWYG editing. These are in tension, and the reason matters:

- NVDA quick-nav keys operate in **browse mode**. Inside any editable region — `contenteditable` or `textarea` alike — NVDA is in **focus mode**, where `H` and `T` simply type those letters. So *no* editor gives quick-nav while editing. That capability can only exist in a read view.
- A `contenteditable` WYSIWYG (TipTap/ProseMirror/Quill) additionally has patchy, inconsistent screen-reader behaviour: unreliable announcement of formatting, caret position and structural changes, varying by browser. It is the option most likely to fight the owner every single day.
- A `textarea` is the most reliably accessible editing surface in the browser. Markdown syntax is spoken clearly and is easy to correct.

So: **edit as Markdown in a textarea; read in a rendered preview built from real semantic HTML** (`<h2>`, `<ul>`, `<table>` with `<th scope>`), where NVDA quick-nav works exactly as expected. The accepted compromise is seeing `## Speaker` rather than large bold text while typing.

Implementation details:

- Edit and Preview as a proper tab pattern (`role="tablist"`, `aria-selected`, arrow-key navigation), or side-by-side on wide screens with the preview in a `<section aria-label="Preview">`. Provide a keyboard shortcut to toggle and document it on the page.
- A formatting toolbar of real `<button>` elements with text accessible names (Heading, Bullet list, Numbered list, Table, Link, Bold). Each inserts Markdown at the caret and returns focus to the textarea.
- **Do not intercept the Tab key in the textarea.** Trapping Tab for indentation is a WCAG 2.1.2 keyboard-trap failure.
- Render Markdown with a small, well-known library (`marked` or `markdown-it`) and **sanitise the output with DOMPurify before inserting it**. The authors are trusted; pasted content is not.
- Give the textarea a real `<label>`, a generous default height, and allow resizing.

Alongside the notes body, the structured fields (title, date text, date status, session status) are ordinary labelled form controls — `<select>` for the two enums, `<input type="text">` for the date. They are read and edited most often and should not be buried in prose.

---

## 6. Pages and routes

Four views. Multi-page HTML is fine and simpler than a router; if using a single page, ensure route changes move focus to the new `<h1>` and update `document.title`.

1. **`/` — Active sessions index.** Table of sessions where `status != 'archived'`: Title (link), Date, Date status, Session status, Last edited. Sortable column headers as `<button>` inside `<th>` with `aria-sort`. A "New session" button. A sensible empty state.
2. **`/session/:id` — One session.** Structured fields, notes editor, save status, last-edited-by line, "Archive this session", and delete behind explicit confirmation.
3. **`/archive` — Archived sessions.** Same table, `status = 'archived'`, plus "Restore to active".
4. **Login view.** Shown whenever `/api/me` returns 401. One labelled passphrase field, `autocomplete="current-password"`, a submit button, errors in `role="alert"`.

---

## 7. Accessibility requirements (acceptance criteria, not aspirations)

The owner is a daily NVDA user. Treat these as tests.

- Semantic HTML first. Landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`. Exactly one `<h1>` per page; headings in order, no skipped levels.
- A "Skip to main content" link as the first focusable element.
- Every control has a programmatic accessible name; every input a real `<label>` (never placeholder-as-label).
- Full keyboard operability, no traps, visible focus indicator everywhere (never `outline: none` without a replacement).
- Focus management: after creating a session, focus the new page's `<h1>`; after closing a dialog, return focus to the trigger; after an async action, announce the result.
- Live regions: `aria-live="polite"` for save status and collaborator updates; `role="alert"` for errors. One region per purpose; never fire on every keystroke.
- Errors are text, adjacent to the field, referenced by `aria-describedby`, never colour-only.
- Contrast ≥ 4.5:1; respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Tables use `<th scope="col">` and a `<caption>`, and are real tables — never a grid of `<div>`s.
- Do not use `aria-*` where a native element exists. Never add `role="application"`.
- Test in Firefox + NVDA on Windows, and verify keyboard-only operation on macOS Safari for the friend.

---

## 8. Repository layout

```
WSRSNotesShare/
  requirements.txt
  Implementation plan.md
  README.md                    <- setup steps, how to rotate a passphrase
  public/                      <- static site, served by Cloudflare Pages
    index.html
    session.html
    archive.html
    css/style.css
    js/api.js                  <- fetch wrappers, 401 -> login handling
    js/editor.js               <- textarea, toolbar, preview, autosave, drafts
    js/index.js                <- index + archive tables, sorting
    js/auth.js                 <- login form
  functions/api/[[path]].js    <- Cloudflare Pages Function (the API)
  schema.sql
  wrangler.toml
  .gitignore                   <- never commit .dev.vars, .env, tokens
```

**Cloudflare Pages Functions** are the simplest form: a file at `functions/api/[[path]].js` in the same repo deploys automatically alongside the static site, same origin, no separate deploy step. Prefer that over a standalone Worker.

Vanilla JS with ES modules and no build step. There is no case here for a framework or bundler: it adds a toolchain to maintain, obscures the HTML that accessibility depends on, and this is a four-page app.

---

## 9. Build phases

In order. Each phase ends in something that runs.

**Phase 0 — Repo and hosting**
- `git init`, initial commit, create the GitHub repo, push. It may be public (it contains no notes) or private; private is tidier.
- Create the free Cloudflare account. Create a Pages project connected to the GitHub repo. Confirm the placeholder site is live at `*.pages.dev`.
- Create a D1 database, bind it in `wrangler.toml`, apply `schema.sql`.
- Set secrets: `PASSPHRASE_A`, `PASSPHRASE_B`, `SESSION_SECRET` (long, randomly generated — not chosen by hand).
- *Acceptance:* pushing to `main` redeploys the site automatically.

**Phase 1 — Auth**
- `/api/login`, `/api/logout`, `/api/me`; cookie signing and verification; constant-time compare; login rate limiting; the login view.
- *Acceptance:* the correct passphrase gets in and stays in after a browser restart; a wrong one gives an announced error; `/api/sessions` returns 401 when signed out.

**Phase 2 — CRUD and index**
- Sessions table, list/create/read/update/delete, index page, archive page, structured fields on the session page.
- *Acceptance:* create a session, set date "March 2026" and status "pencilled in", reload, values persist; archiving moves it between the two lists.

**Phase 3 — The editor**
- Textarea, toolbar, sanitised Markdown preview, debounced autosave, `pagehide` backstop, Save now button, live-region status, `localStorage` draft recovery.
- *Acceptance:* type notes, close the tab without pressing Save, reopen — the notes are there. Kill the network mid-edit and confirm the failure is announced and nothing is lost.

**Phase 4 — Collaboration**
- `/api/versions` polling, 409 conflict handling with the three-way choice, "updated by X" announcements, visibility-aware polling.
- *Acceptance:* two browsers, same session. Edit in one; the other notices within ~15 s. Edit both simultaneously and confirm the conflict is surfaced and neither side's text is lost.

**Phase 5 — Hardening and niceties**
- `/api/export` (download everything as Markdown) — the escape hatch that stops Cloudflare being a single point of failure. Worth doing.
- Optional: a scheduled Worker cron committing a nightly export to a private GitHub repo — free versioned backups and a human-readable copy of the notes in git.
- Full NVDA pass over every page; keyboard-only pass; axe/Lighthouse check.
- README covering passphrase rotation and restoring from an export.

---

## 10. Accepted compromises, stated plainly

| Wanted | Delivered | Why |
|---|---|---|
| Everything on GitHub Pages | Site on Cloudflare Pages, built from the GitHub repo | Static hosting cannot check a passphrase or store notes; same-origin avoids third-party-cookie blocking in Safari and Firefox |
| No new accounts | One free Cloudflare account, owner only | Something must hold a secret. The friend needs nothing but the passphrase, given to him directly |
| WYSIWYG editing with NVDA quick-nav | Markdown textarea + semantic preview | Quick-nav cannot work inside any editable region; `contenteditable` is the least reliable option with screen readers |
| Live real-time collaboration | 15-second polling with clear "they changed it" signalling | Real-time CRDT infrastructure is disproportionate for two people; polling meets the stated need |
| Notes saved on browser close | Debounced autosave + `pagehide` + Save button + local draft | `beforeunload` alone is not reliable enough to trust |
| Sort the index by date | Best-effort sort; blank and unparseable dates sort last | Dates are deliberately free text so "spring 2026" stays expressible |
| A shared passphrase as security | Server-side check + rate limiting + signed cookie | A client-side check is no security at all; rate limiting is what makes a shared passphrase defensible |

---

## 11. Things to explicitly not do

- Do not check the passphrase in client-side JavaScript.
- Do not commit passphrases, tokens or `.dev.vars` to the repo.
- Do not store notes in the public site repo.
- Do not auto-merge conflicting edits, or overwrite a dirty editor with polled content.
- Do not use `innerHTML` on anything user-supplied without DOMPurify.
- Do not build with `<div>`s and ARIA where a native element exists.
- Do not add a framework, bundler, or state library.
