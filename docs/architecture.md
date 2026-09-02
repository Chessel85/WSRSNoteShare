# WSRS Notes Share — Software Architecture

For the site owner. Semi‑technical: it assumes you can read a table and follow a
command, but not that you have used Cloudflare before. It explains what the
pieces are, how GitHub and Cloudflare fit together, and — at the end — how to
change the secret values if you ever think they have leaked.

---

## Contents

1. [The shape of the system](#1-the-shape-of-the-system)
2. [What Cloudflare actually is](#2-what-cloudflare-actually-is)
3. [How GitHub and Cloudflare work together](#3-how-github-and-cloudflare-work-together)
4. [What happens when someone loads a page](#4-what-happens-when-someone-loads-a-page)
5. [Why the site and API share one domain](#5-why-the-site-and-api-share-one-domain)
6. [Authentication](#6-authentication)
7. [The database](#7-the-database)
8. [The API](#8-the-api)
9. [Saving, conflicts and "real‑time"](#9-saving-conflicts-and-real-time)
10. [The notes editor](#10-the-notes-editor)
11. [Environments: production vs local](#11-environments-production-vs-local)
12. [File map](#12-file-map)
13. [Changing the secrets if they are compromised](#13-changing-the-secrets-if-they-are-compromised)

---

## 1. The shape of the system

Three parts, all on one free Cloudflare account:

| Part | What it is | Lives in |
| --- | --- | --- |
| **Site** | Static HTML, CSS and JavaScript. No build step, no framework. | `public/` in this repo |
| **API** | One JavaScript function that handles every `/api/*` request. | `functions/api/[[path]].js` |
| **Store** | A small SQLite database — the single source of truth for all notes. | Cloudflare D1, named `wsrs-notes` |

The browser downloads the static site, and the site's JavaScript talks to the
API over `fetch()`. The API is the only thing that can read or write the
database or check a passphrase. The static files contain no notes and no
secrets, so it does not matter that anyone can read them.

```
        ┌─────────────┐     HTTPS      ┌───────────────────────────┐
        │   Browser   │ ─────────────▶ │      Cloudflare edge      │
        │ (Mac / Win) │ ◀───────────── │                           │
        └─────────────┘                │  /            → static    │
                                       │  /css /js     files       │
                                       │                           │
                                       │  /api/*  → Pages Function ─┼──▶ D1 database
                                       └───────────────────────────┘     (wsrs-notes)
```

---

## 2. What Cloudflare actually is

Cloudflare started as a CDN — a company with servers in hundreds of cities that
sit in front of websites, serving cached copies close to the visitor and
absorbing attacks. Over time they added a platform for running your own code and
data on that same global network. This app uses three of those products:

- **Cloudflare Pages** — hosting for a static website (HTML/CSS/JS files), the
  modern equivalent of GitHub Pages or Netlify. You point it at a Git repo and
  it publishes the files. Free.

- **Pages Functions** — small pieces of server‑side JavaScript that Pages runs
  for you on request, without a server to manage. If you put a file under a
  `functions/` folder in the repo, Pages turns it into a live endpoint
  automatically. Our entire API is one such file. (Under the hood this is
  Cloudflare's "Workers" serverless runtime; a Pages Function is just a Worker
  that Pages deploys alongside your site.) Free tier: 100,000 requests/day —
  vastly more than two people generate.

- **Cloudflare D1** — a managed SQLite database that Functions can query. SQLite
  is a complete SQL database that stores everything in a single file; D1 is
  Cloudflare running and replicating that for you. Free tier: 5 GB and millions
  of reads/day.

Nothing here costs money at this scale, and there is no server, container or
operating system for you to patch. You push code; Cloudflare runs it.

**Key terms you will meet in the dashboard**

| Term | Meaning here |
| --- | --- |
| Project | The Pages project, named `wsrs-notes`. Everything hangs off this. |
| Deployment | One published version of the site, produced from one Git commit. |
| Binding | A named connection from your code to a resource. `DB` is the binding name the API uses to reach the D1 database. |
| Secret | An encrypted environment variable (passphrases, signing key). Set once, never shown again, never in the repo. |
| `*.pages.dev` | The free domain every Pages project gets, e.g. `wsrs-notes.pages.dev`. You can add a custom domain later. |

---

## 3. How GitHub and Cloudflare work together

**GitHub holds the code. Cloudflare runs it. A `git push` is the link between
them.**

The setup (done once) connected the Cloudflare Pages project to this GitHub
repository. From then on:

1. You make changes locally and `git push` them to the `main` branch on GitHub.
2. GitHub notifies Cloudflare (via a webhook created during setup).
3. Cloudflare pulls the latest commit, takes the `public/` folder as‑is (there
   is no build command), and publishes it as a new **deployment**.
4. It also bundles `functions/api/[[path]].js` into the Worker that serves
   `/api/*`, using the same commit.
5. A minute or so later the live site at `wsrs-notes.pages.dev` is running the
   new code. The previous deployment is kept, so you can roll back from the
   dashboard with one click.

```
   your machine ──git push──▶ GitHub (main) ──webhook──▶ Cloudflare Pages
                                                              │
                                              build (none) + deploy
                                                              ▼
                                        https://wsrs-notes.pages.dev  (live)
```

Things that are **not** in Git and are configured in the Cloudflare dashboard
instead, because they are either secret or environment‑specific:

- the three secrets (`PASSPHRASE_A`, `PASSPHRASE_B`, `SESSION_SECRET`) and the
  two optional name labels (`NAME_A`, `NAME_B`);
- the **D1 binding** — the wiring that makes the name `DB` in the code point at
  the `wsrs-notes` database.

So GitHub is the source of truth for *behaviour*, and the Cloudflare dashboard
is the source of truth for *secrets and connections*. Neither can deploy the app
without the other.

`wrangler.toml` in the repo records the non‑secret Cloudflare config (project
name, that the output directory is `public`, the D1 database id). `wrangler` is
Cloudflare's command‑line tool; it is what the setup steps in the README use to
create the database and set secrets.

---

## 4. What happens when someone loads a page

1. Browser requests `https://wsrs-notes.pages.dev/`. Cloudflare's nearest edge
   location serves `public/index.html` and the CSS/JS it references.
2. `js/app.js` runs and calls `GET /api/me` to find out if this browser has a
   valid session cookie.
3. That request hits the Pages Function. It reads the `wsrs_session` cookie,
   checks the signature and expiry, and replies `{ user: "…" }` or `401`.
4. On `401` the page renders the login form. On success it renders the app and
   calls `GET /api/sessions` (etc.), which the Function answers by querying D1
   through the `DB` binding.
5. Every later action (create, open, save, poll, export) is another `fetch` to
   `/api/*`, handled by the same one Function file, talking to the same D1
   database.

There is only ever **one** copy of the data — the D1 database. Both users, on
both machines, read and write that same copy.

---

## 5. Why the site and API share one domain

Both the static site and `/api/*` are served from `wsrs-notes.pages.dev`. That
is deliberate and load‑bearing.

Because they are the **same origin**, the login can use an
`HttpOnly; Secure; SameSite=Lax` cookie. `HttpOnly` means JavaScript cannot read
it, so a stray script or a browser extension cannot steal the session. No
cross‑origin setup (CORS) is needed.

If the site were on `github.io` and the API on `workers.dev`, that session
cookie would be a **third‑party cookie**. Safari on macOS blocks those outright,
and Firefox's Total Cookie Protection isolates them — the login would
intermittently just stop working. Keeping everything on one domain avoids the
entire problem. Do not split them.

---

## 6. Authentication

**Two passphrases, no accounts.** `PASSPHRASE_A` and `PASSPHRASE_B` are stored as
Cloudflare secrets, one per person. Having two (rather than one shared secret)
means edits can be attributed — "Saved 14:32 by …" — and either can be rotated
without disturbing the other.

**Login flow** (`POST /api/login`):

1. The Function SHA‑256‑hashes the submitted passphrase and compares it, using a
   **constant‑time** comparison, against the hash of each secret. Constant‑time
   means the comparison takes the same time whether the first byte or no byte
   matches, so an attacker cannot learn the passphrase from response timing. It
   checks both secrets every time for the same reason, and the error is always
   the generic "Incorrect passphrase" — it never reveals which one was close.
2. On success it sets `wsrs_session`, a cookie whose value is
   `base64url(payload) . base64url(HMAC-SHA256(payload, SESSION_SECRET))`. The
   payload is just `{"u":"<name>","exp":<unix time>}`. Because it is signed with
   `SESSION_SECRET`, the client cannot forge or tamper with it; because it
   carries its own expiry, it is good for 90 days then rejected.
3. Every `/api/*` request except login re‑verifies that signature and expiry
   before doing anything.

**Rate limiting.** `POST /api/login` is capped at **10 attempts per IP address
per 15 minutes**, tracked in the `login_attempts` table in D1. This is what
makes a word‑based shared passphrase defensible — without it, someone could
guess at HTTP speed.

**`SESSION_SECRET`** is a long random string (e.g. `openssl rand -base64 48`). It
is only ever used to sign and verify the cookie. Changing it invalidates every
existing cookie — see [§13](#13-changing-the-secrets-if-they-are-compromised).

`NAME_A` / `NAME_B` are optional secrets holding the display names for each slot.
If unset, the app shows "Owner" and "Friend".

---

## 7. The database

Defined in `schema.sql`. Two tables.

### `sessions` — one row per Listening Session

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | UUID, generated server‑side on create. Used in the page URL. |
| `title` | TEXT | Free text. |
| `date_text` | TEXT | **Free text on purpose** — `''`, `March 2026`, `14 March 2026`. A real date column would make "spring 2026" unrepresentable. Sorting the index by date is therefore best‑effort; blank/unparseable dates sort last. |
| `date_status` | TEXT | One of `none`, `rough`, `pencilled`, `confirmed`. |
| `status` | TEXT | One of `idea`, `firming_up`, `well_formed`, `ready`, `archived`. Archiving is just this column — there is no separate archive table. |
| `session_type` | TEXT | One of `tbc`, `listening`, `learning`. Shown as "Type" (To be confirmed / Listening session / Learning session); defaults to `tbc`. |
| `notes_md` | TEXT | The notes, as Markdown. Capped at ~200 KB. |
| `version` | INTEGER | Incremented on every save. Powers conflict detection and change polling (see §9). |
| `updated_at` | TEXT | ISO‑8601 UTC. |
| `updated_by` | TEXT | Display name of whoever last saved. |
| `created_at` | TEXT | ISO‑8601 UTC. |

Index on `status` so the active/archived split is cheap.

### `login_attempts` — rate‑limit counters

One row per `(ip, 15‑minute window)`, holding a count. Old rows are cleared
opportunistically on each failed attempt. Nothing sensitive; it could be wiped
at any time with no lasting effect.

The server **re‑validates every write**: `date_status`, `status`, and
`session_type` must be one of the allowed values, the title length and notes
size are bounded, and the `version` must be an integer. The client's copy of the
rules is never trusted.

Adding `session_type` to a database created before it existed: run
`migrations/2026-09-02-session-type.sql` (`schema.sql` already carries it for
fresh installs).

---

## 8. The API

One file, `functions/api/[[path]].js`. The `[[path]]` filename is Cloudflare's
catch‑all convention: this one Function receives **every** request under `/api/`
and routes internally by path and method. All responses are JSON. All require a
valid session cookie except `POST /api/login`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/login` | Check a passphrase, set the session cookie. |
| POST | `/api/logout` | Clear the cookie. |
| GET | `/api/me` | "Am I signed in?" — used on every page load. |
| GET | `/api/sessions?archived=0\|1` | List sessions (no notes body, to keep it small). |
| POST | `/api/sessions` | Create a session. |
| GET | `/api/sessions/:id` | One full session, including notes. |
| PUT | `/api/sessions/:id` | Save a session. Returns `409` + the current server copy if the version moved. |
| DELETE | `/api/sessions/:id` | Delete permanently. |
| GET | `/api/versions` | Tiny list of `{id, version, updated_at, updated_by}`. The polling endpoint. |
| GET | `/api/export?format=md\|json` | Download every session as one file. |

Errors are deliberately vague to the client (`"Something went wrong"`, `500`) and
logged in full to the Cloudflare dashboard for you.

---

## 9. Saving, conflicts and "real‑time"

**Saving** is layered so notes survive leaving the page (this is all in
`public/js/session.js`):

1. debounced autosave 1.5 s after typing stops — the real mechanism;
2. save on field blur and when the tab is hidden;
3. a `pagehide` "keepalive" request as a last resort when the tab closes;
4. an explicit **Save now** button, plus Ctrl/Cmd+S in the editor;
5. a per‑device copy mirrored into `localStorage` on every keystroke, offered
   back on reload if it is newer than the server copy.

**Conflicts.** Every `PUT` sends the `version` the client loaded. The server's
`UPDATE … WHERE id = ? AND version = ?` only succeeds if that version is still
current; if not, it changes zero rows and the API returns **409** with the
current server record. The client then offers **Keep mine / Use theirs / Show
both** (append theirs under a `## Conflicted copy` heading). Nothing is
auto‑merged; nothing is discarded without the user choosing it.

**"Real‑time"** is polling, not websockets — the right size for two people. While
a session page is open it calls `GET /api/versions` every 15 s (paused when the
tab is hidden). If the open session's version has risen and the editor is clean,
the page refreshes to the new version in place and announces it. If the editor
is dirty, a banner appears and the editor is left untouched.

---

## 10. The notes editor

A plain `<textarea>` of Markdown plus a **Write / Preview** tab pair
(`public/js/editor.js`). The preview is generated by `marked` and then **always**
passed through `DOMPurify` before it is put on the page — the note authors are
trusted, but pasted‑in content is not. Both libraries are **vendored**: pinned
copies live in `public/js/vendor/` and are served from our own domain, so there
is no third‑party script dependency at runtime.

Why not a live formatted editor? Screen‑reader structure navigation cannot work
inside any editable region, and rich `contenteditable` editors behave
inconsistently with assistive tech. A textarea is the most reliable surface to
type into; the Preview tab is real semantic HTML for reading back.

---

## 11. Environments: production vs local

**Production** is the deployed Pages project. Secrets and the D1 binding are set
in the Cloudflare dashboard (or via `wrangler`). Pushing to `main` redeploys it.

**Local development** uses `wrangler pages dev`, which runs the site, the
Function and a local SQLite copy on your machine:

```
cp .dev.vars.example .dev.vars     # then edit in real values
wrangler d1 execute wsrs-notes --local --file=schema.sql
wrangler pages dev
```

`.dev.vars` holds the same variable names as the production secrets but as a
plain local file. It is listed in `.gitignore` and **must never be committed**.
The local D1 database is a separate file under `.wrangler/` and has nothing to do
with production data.

---

## 12. File map

```
public/                      static site (served as-is by Pages)
  index.html                 active sessions index
  session.html               one session (loads the editor)
  archive.html               archived sessions
  css/style.css
  js/api.js                  fetch wrappers + ApiError
  js/app.js                  auth gate + shared header/nav/sign-out
  js/auth.js                 login form
  js/index.js                active index + "New session"
  js/archive.js              archived list + restore
  js/session.js              session page: fields, saving, polling, conflicts
  js/sessions-table.js       shared sortable table
  js/labels.js               enum labels, date sort key, date formatting
  js/editor.js               Markdown textarea + toolbar + sanitised preview
  js/vendor/                 pinned same-origin marked + DOMPurify
functions/api/[[path]].js    the entire API (one Pages Function)
schema.sql                   D1 schema (both tables)
wrangler.toml                non-secret Cloudflare config + D1 database id
.dev.vars                    local-only secrets (git-ignored)
docs/                        this guide and the user guide
```

---

## 13. Changing the secrets if they are compromised

"Compromised" means: a passphrase was seen by someone who should not have it, a
laptop that stays signed in was lost or stolen, `SESSION_SECRET` was exposed, or
you simply want a clean slate. None of this needs a code change or a redeploy —
secrets are separate from the code.

### What each secret is, and what rotating it does

| Secret | If you change it… |
| --- | --- |
| `PASSPHRASE_A` | Person A must sign in again with the new phrase. Existing signed‑in sessions are **not** kicked out (they ride on the cookie, not the passphrase). Person B is unaffected. |
| `PASSPHRASE_B` | Same, for person B. |
| `SESSION_SECRET` | **Every** existing cookie becomes invalid immediately. Both people are signed out everywhere and must sign in again. This is the "force everyone out" lever. |
| `NAME_A` / `NAME_B` | Just changes the display name shown against edits. Harmless. |

**So:** if only a passphrase leaked, rotate that passphrase **and**
`SESSION_SECRET` together — the passphrase change stops future logins, and the
`SESSION_SECRET` change ends any session the intruder may already have. If you
only suspect a stale signed‑in device, rotating `SESSION_SECRET` alone is
enough.

### Generating a new `SESSION_SECRET`

`SESSION_SECRET` is not a memorable phrase — it is the key the server signs the
login cookie with, so it must be long and genuinely random, never typed by hand.
The originals were made with `openssl rand -base64 48`: 48 random bytes,
base64‑encoded, which comes out as a **64‑character** string like
`k9Qk1u7wS0p2Xz...==`. Aim for roughly that (44 characters is the practical
floor; more is fine). Any one of these produces a suitable value — run it, copy
the single line it prints, and paste that as the new secret:

```bash
# macOS / Linux / Git Bash / WSL — needs openssl (installed by default on both Macs and Git for Windows)
openssl rand -base64 48
```

```powershell
# Windows PowerShell — no extra tools, uses the OS cryptographic RNG
$b = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

```bash
# Anywhere Node.js is installed
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

```bash
# Anywhere Python 3 is installed
python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(48)).decode())"
```

If none of those are handy, a password manager's generator set to 50–64
characters (letters + digits + symbols) is an acceptable substitute — the only
requirement is length and randomness, not the base64 format specifically.

Treat the value like a password: don't paste it into chat or email, and once
it's set in Cloudflare (and, if you use local dev, in `.dev.vars`) there's no
need to keep a copy anywhere else. If you lose it, you generate a fresh one and
rotate again — the cost is just that everyone signs in once more.

### Method A — Cloudflare dashboard (no tools needed)

1. Go to **dash.cloudflare.com** → **Workers & Pages** → the **`wsrs-notes`**
   project.
2. **Settings** → **Environment variables and secrets** (under the
   **Production** environment).
3. For each secret to change: select **Edit**, paste the new value, **Save**.
   To replace `SESSION_SECRET`, generate a fresh random value first — see
   [Generating a new `SESSION_SECRET`](#generating-a-new-session_secret) just
   above.
4. Secrets take effect on the next request — usually seconds. There is normally
   no need to redeploy, but if anything seems stale, **Deployments** → the
   latest → **Retry deployment** (or push any commit) forces a fresh start.
5. Tell the affected person their new passphrase **directly** — in a call or in
   person, never by email or chat. If you rotated `SESSION_SECRET`, tell both
   people they will need to sign in again.

### Method B — `wrangler` command line

From the repo folder, with `wrangler` installed and `wrangler login` done:

```bash
# A passphrase (you will be prompted to paste the new value, hidden):
wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes

# The session signing key — pipe in a fresh random value:
openssl rand -base64 48 | wrangler pages secret put SESSION_SECRET --project-name wsrs-notes

# See what secrets exist (names only, never values):
wrangler pages secret list --project-name wsrs-notes
```

Same effect as the dashboard: live within seconds, no redeploy required.

### After rotating — checklist

- [ ] New passphrase communicated to the affected person privately.
- [ ] If `SESSION_SECRET` was changed: both people told to sign in again.
- [ ] `.dev.vars` on your own machine updated to match, if you kept the old
      values there (local only — it is never deployed).
- [ ] You can still sign in yourself with your own (possibly unchanged)
      passphrase.
- [ ] If a passphrase leaked publicly, consider downloading a
      [backup](user-guide.md#downloading-a-backup) and skimming the sessions for
      anything that was visible while it was exposed.

### What you never need to do

- You do **not** edit `wrangler.toml` or any file in the repo to rotate a
  secret — secrets are not stored there.
- You do **not** touch the D1 database. Passphrases and the signing key are not
  in it; sessions are not stored server‑side.
- You do **not** need to rebuild or reconnect the GitHub link.
