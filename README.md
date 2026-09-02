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

## Editing notes

Notes are written as Markdown in a plain `<textarea>` (the most reliably
accessible editing surface) with a **Write** / **Preview** tab pair — `F2`
toggles between them. The Preview tab is real semantic HTML, so NVDA quick-nav
(`H` for headings, `L` for lists, `T` for tables) works there. Quick-nav cannot
work while editing — inside any editable region NVDA is in focus mode — so the
accepted trade-off is seeing `## Speaker` rather than large bold text while
typing.

The toolbar buttons work on the current selection: select the text first, then
press **Heading**, **Bold**, **Bullet list** or **Numbered list**. With nothing
selected they insert a placeholder at the cursor. **Table** with several lines
selected turns them into a table — one row per line, cells split on a comma or
tab, the first line as the header row; with nothing selected it inserts a
starter table to fill in.

Saving is automatic: 1.5 s after you stop typing, on leaving a field, and as a
backstop when the tab closes. There is also a **Save now** button (`Ctrl+S` in
the editor). A per-device copy is mirrored to the browser as you type; if you
reopen a session with newer unsaved changes on that device, it offers to
restore them rather than overwriting either side. Preview HTML is sanitised
with DOMPurify before display.

## Working together

While a session is open it checks every 15 seconds for changes the other
person has made (polling `GET /api/versions`; paused while the tab is hidden,
resumed on return). If they saved something and your editor has no unsaved
changes, the page quietly refreshes to their version and announces "Updated by
&hellip;". If you _do_ have unsaved changes, a banner appears instead and
nothing you typed is touched — save first, then reload.

If you both saved edits to the same session, the second save is rejected and
you are offered a three-way choice: **Keep mine** (replace theirs), **Use
theirs** (discard your changes), or **Show both** (append theirs under a
`## Conflicted copy` heading so you can merge by hand). Edits are never
auto-merged and no side's text is discarded without you choosing it.

## Rotating a passphrase

Only the owner can do this, and it needs no code change:

```
wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes
```

Enter the new three-word passphrase. It takes effect on the next deploy/request.
Existing sessions stay signed in until their 90-day cookie expires; to force
everyone out, also rotate `SESSION_SECRET`.

## Backups and restoring

### Taking a backup

Signed in, the active-sessions page has **"Download a backup of every session:
Markdown · JSON"** at the foot of the list. Both cover every session, active and
archived. Direct links (session cookie required):

```
https://wsrs-notes.pages.dev/api/export?format=md
https://wsrs-notes.pages.dev/api/export?format=json
```

- **Markdown** (`wsrs-notes-YYYY-MM-DD.md`) — human-readable: one `##` section per
  session with a details table (status, date, last edited, version, id) followed
  by its notes verbatim. This is the copy to keep and read.
- **JSON** (`wsrs-notes-YYYY-MM-DD.json`) — `{exported_at, count, sessions:[…]}`
  with every column, including `version` and timestamps. This is the copy to
  restore from.

Do this now and then, and keep the file somewhere that is not Cloudflare.

### Restoring after losing Cloudflare

There is no bulk import endpoint by design (two people, rare event). To rebuild:

1. Stand the app back up: create a new D1 database, apply `schema.sql`, redeploy
   (see one-time setup above).
2. From the most recent JSON export, recreate each session. Either re-enter them
   by hand from the Markdown copy, or feed the JSON to `wrangler d1 execute`, e.g.
   generate one `INSERT INTO sessions (...) VALUES (...)` per element of
   `sessions[]` and run:
   ```
   wrangler d1 execute wsrs-notes --remote --file=restore.sql
   ```
   Keep each row's original `id`, `created_at` and `version` so links and
   conflict detection stay consistent.

### Optional: nightly off-site backup (cron)

Pages Functions cannot run on a schedule, so an automated backup is a **separate,
optional Worker** in its own project. Sketch:

```js
// backup-worker/src/index.js  — deploy with its own wrangler.toml + cron trigger
export default {
  async scheduled(_event, env, ctx) {
    const res = await fetch("https://wsrs-notes.pages.dev/api/export?format=json", {
      headers: { cookie: `wsrs_session=${env.BACKUP_SESSION_COOKIE}` },
    });
    const body = await res.text();
    // PUT it to a private GitHub repo via the contents API, or to an R2 bucket.
    await fetch(
      "https://api.github.com/repos/<you>/<private-backup-repo>/contents/wsrs-notes-latest.json",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "user-agent": "wsrs-backup",
          accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          message: `backup ${new Date().toISOString()}`,
          content: btoa(unescape(encodeURIComponent(body))),
          sha: env.LAST_SHA, // omit on first run; fetch current sha on later runs
        }),
      }
    );
  },
};
```

```toml
# backup-worker/wrangler.toml
name = "wsrs-notes-backup"
main = "src/index.js"
compatibility_date = "2025-09-01"
[triggers]
crons = ["17 3 * * *"]   # 03:17 UTC nightly
```

Secrets on that worker: `BACKUP_SESSION_COOKIE` (sign in once as a normal user and
copy the `wsrs_session` cookie value — it lasts 90 days, so refresh it quarterly),
`GITHUB_TOKEN` (a fine-grained PAT with Contents: read/write on the private backup
repo only). This is a nicety, not required — a manual download every week or two
is enough for two people.

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
  js/editor.js              Markdown textarea, toolbar, sanitised preview (Phase 3)
  js/vendor/                pinned, same-origin copies of marked + DOMPurify
functions/api/[[path]].js   the API (Pages Function)
schema.sql                  D1 schema
wrangler.toml               Pages + D1 config
```
