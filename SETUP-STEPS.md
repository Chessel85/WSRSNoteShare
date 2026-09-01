# One-time setup — detailed walkthrough

**DELETE THIS FILE when you have finished.** It contains no secrets, but there is
no reason to keep it in the repo. `README.md` keeps the short version permanently.

This is the long, click-by-click version of `README.md` → "One-time setup". Work
top to bottom. You do everything here once; after it, pushing to `main` on GitHub
redeploys the site by itself.

Things you will create:

| Where | What | Cost |
|---|---|---|
| your PC | Node.js + the Wrangler CLI | free |
| dash.cloudflare.com | a Cloudflare account | free |
| dash.cloudflare.com | a D1 database (`wsrs-notes`) | free tier |
| dash.cloudflare.com | a Pages project (`wsrs-notes`) connected to your GitHub repo | free tier |

Your GitHub repo already exists and is already pushed:
`github.com/Chessel85/WSRSNoteShare` (note: the GitHub repo name has no "s" on
"Note"; the local folder is `WSRSNotesShare`. This mismatch does not matter.)

Terminal commands below are **PowerShell**, run from the repo folder
`C:\Users\chess\github\WSRSNotesShare`. In Claude Code you can run a command by
typing `!` followed by the command.

---

## Part A — Install local tools (your PC)

You need these because the database schema is applied from your machine, not from
a website.

### A1. Install Node.js (which includes npm)

1. Check whether it is already there:
   ```
   node --version
   ```
   If that prints something like `v20.x` or higher, skip to A2.
2. Install it. Easiest on Windows 11:
   ```
   winget install OpenJS.NodeJS.LTS
   ```
   If `winget` is unavailable, download the "LTS" Windows installer from
   `https://nodejs.org/` and run it with default options.
3. **Close and reopen your terminal**, then confirm:
   ```
   node --version
   npm --version
   ```
   Both must print a version number.

### A2. Install Wrangler (the Cloudflare CLI)

Install it globally:
```
npm install -g wrangler
```
Confirm:
```
wrangler --version
```

### A3. Sign in Wrangler to Cloudflare

If you do not yet have a Cloudflare account, do **Part B first**, then come back.

```
wrangler login
```
This opens your browser to a Cloudflare "Authorize Wrangler" page. Read down the
page, activate the **Allow** button. The browser then says you can close the tab;
the terminal prints `Successfully logged in`.

Confirm it worked:
```
wrangler whoami
```
It should show your Cloudflare account email and an Account ID.

---

## Part B — Create a Cloudflare account (dash.cloudflare.com)

1. Go to `https://dash.cloudflare.com/sign-up`.
2. Enter your email (`ckgoodwin85@gmail.com`) and a strong password. Submit the
   **Sign up** button.
3. Open the verification email from Cloudflare and activate its confirmation link.
4. You land on the Cloudflare dashboard home. You do **not** need to add a domain,
   enter card details, or pick a paid plan. If a wizard pushes you toward adding a
   website, look for a "Skip" / "Do this later" link, or just go straight to
   `https://dash.cloudflare.com/` afterwards.

Landmark note for NVDA: the dashboard is a normal web app with a left `navigation`
region ("Account Home", "Workers & Pages", etc.) and a `main` region. Most steps
below start from the **Workers & Pages** item in that left navigation.

---

## Part C — Create the D1 database

D1 is Cloudflare's SQLite. It is the single source of truth for the notes.

### C1. Create it (terminal)

```
wrangler d1 create wsrs-notes
```

Output looks like:
```
✅ Successfully created DB 'wsrs-notes'
[[d1_databases]]
binding = "DB"
database_name = "wsrs-notes"
database_id = "0d1e2f3a-4b5c-6d7e-8f90-1a2b3c4d5e6f"
```

### C2. Put the database_id into wrangler.toml

1. Open `wrangler.toml` in the repo.
2. Find the line:
   ```
   database_id = "REPLACE_WITH_DATABASE_ID"
   ```
3. Replace `REPLACE_WITH_DATABASE_ID` with the real `database_id` string from C1
   (keep the quotes). The database_id is not secret; it is fine to commit.
4. Save.

### C3. Commit and push that change

```
git add wrangler.toml
git commit -m "Add D1 database_id"
git push
```

### C4. Apply the schema to the remote database

```
wrangler d1 execute wsrs-notes --remote --file=schema.sql
```
It lists the statements and asks for confirmation — activate **Yes**. You should
see it report that 2 tables and the indexes were created.

Verify:
```
wrangler d1 execute wsrs-notes --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```
Expected: rows for `sessions` and `login_attempts`.

---

## Part D — Create the Pages project connected to GitHub (dash.cloudflare.com)

This is what builds and serves the site, on the same domain as the API.

1. In the dashboard left navigation, activate **Workers & Pages**.
2. Activate the **Create application** button.
3. Choose the **Pages** tab, then activate **Connect to Git**.
4. **Authorize GitHub:** a dialog asks to connect your GitHub account. Activate
   **Connect GitHub**. GitHub opens an "Install Cloudflare Pages" page.
   - Choose your account **Chessel85**.
   - Select **Only select repositories**, choose **WSRSNoteShare**.
   - Activate **Install & Authorize**. You return to Cloudflare.
5. Back on Cloudflare, in the repository list pick **WSRSNoteShare**, then activate
   **Begin setup**.
6. **Set up builds and deployments** form — enter exactly:
   - **Project name:** `wsrs-notes`  (this becomes `wsrs-notes.pages.dev`; the
     name is also used by `wrangler pages ...` commands, so match it)
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** leave empty
   - **Build output directory:** `public`
   - Leave "Root directory" as the repo root (blank / `/`).
7. Activate **Save and Deploy**.
8. The first build runs. It will **succeed at serving files** but the app will not
   log in yet because the secrets and the database binding are not attached. That
   is expected — do Part E next.
9. When the build finishes, note the URL: `https://wsrs-notes.pages.dev`.

---

## Part E — Attach the database and secrets to the Pages project

The Pages **project** needs its own D1 binding and its own secrets. (The
`wrangler.toml` binding covers local dev and Wrangler commands; the deployed
Pages Function reads from the project settings you set here.)

### E1. Generate SESSION_SECRET

Run this in PowerShell and copy the whole output line:
```
$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b)
```
It prints ~64 characters ending in `=`. That is `SESSION_SECRET`. Do not hand-pick
one; do not reuse it anywhere else. If you ever paste it into the dashboard, keep
it out of screenshots and chat.

### E2. Choose the two passphrases

Pick two different three-word passphrases, e.g. `LionCabbageKingfisher` and
`OtterBrambleCurlew`. One is yours (`PASSPHRASE_A`), one is your friend's
(`PASSPHRASE_B`). Optionally also set `NAME_A` / `NAME_B` (e.g. `Chris`, `Alex`)
so edits are attributed by name instead of "Owner" / "Friend".

**Tell your friend his passphrase directly** — say it on a call, or send it in a
channel only the two of you use. It never goes in the repo or in an email.

### E3. Add the secrets (choose one method)

**Method 1 — terminal (recommended, less clicking):**
```
wrangler pages secret put SESSION_SECRET --project-name wsrs-notes
wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes
wrangler pages secret put PASSPHRASE_B --project-name wsrs-notes
```
Each command prompts `Enter a secret value:` — paste the value, press Enter. It
confirms the secret was added. (Optional: repeat for `NAME_A`, `NAME_B`.)

**Method 2 — dashboard:**
1. **Workers & Pages** → open **wsrs-notes** → **Settings** tab → **Variables and
   secrets** (under "Environment variables").
2. Make sure the environment selector says **Production**.
3. Activate **Add**. For each: enter the **Variable name**, enter the **Value**,
   and change its **Type** to **Secret** (not "Text") so the value is encrypted
   and hidden. Add `SESSION_SECRET`, `PASSPHRASE_A`, `PASSPHRASE_B` (and
   optionally `NAME_A`, `NAME_B`).
4. Activate **Save**.

### E4. Bind the D1 database to the project (dashboard only)

1. **Workers & Pages** → open **wsrs-notes** → **Settings** tab.
2. Find **Bindings** (or "Functions" → "D1 database bindings" on older dashboard
   layouts). Activate **Add binding**.
3. **Variable name:** `DB`  (must be exactly `DB`, capital letters)
4. **D1 database:** choose `wsrs-notes` from the list.
5. Make sure it is applied to the **Production** environment. Activate **Save**.

### E5. Redeploy so the new settings take effect

Secrets and bindings only apply to **future** deployments.

- Dashboard: **wsrs-notes** → **Deployments** tab → open the latest deployment →
  activate **Retry deployment** (or **Manage deployment** → **Retry**).
- Or from the terminal, push any commit:
  ```
  git commit --allow-empty -m "Redeploy with secrets and D1 binding"
  git push
  ```

Wait for the new deployment to reach **Success**.

---

## Part F — Verify it works

1. **API rejects anonymous requests.** In a browser, open
   `https://wsrs-notes.pages.dev/api/me`. Expected: `{"error":"Not signed in"}`
   with a 401 status. If you instead see `{"error":"Something went wrong"}`, the
   `SESSION_SECRET` or `DB` binding is missing — recheck Part E, then redeploy.

2. **The site loads.** Open `https://wsrs-notes.pages.dev/`. You should get the
   "Sign in" heading and a single **Passphrase** field.

3. **Wrong passphrase is refused and announced.** Type anything wrong, activate
   **Sign in**. Expected: an alert reading "Incorrect passphrase". NVDA should
   announce it because it is a `role="alert"`.

4. **Correct passphrase gets in.** Type `PASSPHRASE_A`, activate **Sign in**.
   Expected: the page changes to "Active sessions" with "Signed in as ..." and a
   **Sign out** button in the header.

5. **The session persists.** Fully close the browser, reopen it, go back to the
   site. You should still be signed in (the cookie lasts 90 days).

6. **Rate limiting works.** Sign out. Submit a wrong passphrase 10 times. On the
   11th attempt within 15 minutes you should get "Too many attempts. Wait 15
   minutes and try again." (You can clear this early with:
   `wrangler d1 execute wsrs-notes --remote --command "DELETE FROM login_attempts;"`)

7. **Sign out works.** Activate **Sign out**; you are returned to the login view.

If all seven pass, Phase 0 and Phase 1 are accepted. Tell Claude Code to continue
with Phase 2.

---

## If something goes wrong

- **Build fails immediately in Cloudflare:** check the build log in the
  **Deployments** tab. The output directory must be `public` and the build
  command must be empty.
- **`/api/me` returns 500:** missing `SESSION_SECRET` or `DB`. Confirm both exist
  on the **Production** environment (Part E), then redeploy (E5). Settings do not
  apply to already-built deployments.
- **Login always fails with the right passphrase:** the passphrase secret has a
  stray space or newline. Re-run `wrangler pages secret put PASSPHRASE_A
  --project-name wsrs-notes` and paste carefully, then redeploy.
- **`wrangler` says "not logged in":** re-run `wrangler login` (A3).
- **`wrangler d1 execute` says the database is unknown:** the name in the command
  must be `wsrs-notes` and `wrangler whoami` must show the account that owns it.

---

## Quick reference — passphrase rotation (after setup, keep in README)

```
wrangler pages secret put PASSPHRASE_A --project-name wsrs-notes
git commit --allow-empty -m "Rotate passphrase" && git push
```
To force both people to sign in again, also rotate `SESSION_SECRET` the same way.
