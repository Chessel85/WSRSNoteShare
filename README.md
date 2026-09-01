# WSRS Listening Sessions Notes

A small, accessible web app where two people share notes on WSRS Listening Sessions.
Single source of truth in Cloudflare D1. See `Implementation plan.md` for the design
rationale and `requirements.txt` for the original brief.

## Architecture

| Part | What | Where |
|---|---|---|
| Site | Static HTML/CSS/JS, no build step | `public/`, served by Cloudflare Pages |
| API | One Pages Function | `functions/api/[[path]].js` |
| Store | Cloudflare D1 (SQLite) | binding `DB` in `wrangler.toml` |

Site and API are the **same origin**, so the login uses an `HttpOnly; Secure` cookie
with no CORS. Do not split them onto separate domains.

## One-time setup (repo owner)

Prerequisites: a free Cloudflare account and `npm i -g wrangler`, then `wrangler login`.

1. **Push this repo to GitHub** (private is tidier; it contains no notes).

2. **Create the D1 database:**
   ```
   wrangler d1 create wsrs-notes
   ```
   Paste the printed `database_id` into `wrangler.toml`.

3. **Apply the schema:**
   ```
   wrangler d1 execute wsrs-notes --remote --file=schema.sql
   ```

4. **Create the Pages project:** Cloudflare dashboard → Workers & Pages → Create →
   Pages → Connect to Git → pick this repo. Build command: none. Output directory:
   `public`. The `[[path]].js` Function deploys automatically.

5. **Set the secrets** (three-word passphrases; `SESSION_SECRET` randomly generated):
   ```
   wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes
   wrangler pages secret put PASSPHRASE_B --project-name wsrs-notes
   wrangler pages secret put SESSION_SECRET --project-name wsrs-notes   # e.g. `openssl rand -base64 48`
   ```
   Bind the D1 database to the Pages project too: dashboard → the project →
   Settings → Functions → D1 database bindings → add `DB` = `wsrs-notes`.

6. **Tell your friend his passphrase directly** (verbally / privately). There is no
   invite flow, no email, no password reset by design.

After this, pushing to `main` redeploys the site automatically.

## Local development

```
cp .dev.vars.example .dev.vars     # fill in real values; .dev.vars is git-ignored
wrangler d1 execute wsrs-notes --local --file=schema.sql
wrangler pages dev
```

## Rotating a passphrase

Only the owner can do this, and it needs no code change:

```
wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes
```

Enter the new three-word passphrase. It takes effect on the next deploy/request.
Existing sessions stay signed in until their 90-day cookie expires; to force
everyone out, also rotate `SESSION_SECRET`.

## Restoring from an export

`GET /api/export` downloads every session as Markdown (or JSON). If Cloudflare is
ever lost, the notes can be recreated from the most recent export. Keep exports
somewhere safe; an optional nightly cron backup is described in the plan (Phase 5).

## Files

```
public/                     static site
  index.html                active sessions index
  session.html              one session (editor)
  archive.html              archived sessions
  css/style.css
  js/api.js                 fetch wrappers + ApiError
  js/app.js                 shared auth gate + header/nav/sign-out shell
  js/auth.js                login form
  js/index.js               active sessions index + "New session" (Phase 2)
  js/archive.js             archived sessions + restore (Phase 2)
  js/session.js             session page: structured fields, save, delete (Phases 2-4)
  js/sessions-table.js      shared sortable table (Phase 2)
  js/labels.js              enum labels + date sort key (Phase 2)
  js/editor.js              textarea, toolbar, preview, autosave, drafts (Phase 3)
functions/api/[[path]].js   the API (Pages Function)
schema.sql                  D1 schema
wrangler.toml               Pages + D1 config
```
