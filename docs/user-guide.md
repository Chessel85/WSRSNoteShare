# WSRS Notes Share — User Guide

A shared place for two people to keep notes on WSRS Listening Sessions: the Zoom
talks with guest speakers that take planning, chasing and note‑keeping to pull
together. Everything you type is saved to one central copy, so you both always
see the same thing.

This guide covers what the app does and how to use it. It assumes nothing
technical.

---

## Contents

1. [Signing in](#signing-in)
2. [The Active sessions page](#the-active-sessions-page)
3. [Creating a session](#creating-a-session)
4. [A session page](#a-session-page)
5. [Writing notes](#writing-notes)
6. [How saving works](#how-saving-works)
7. [Working at the same time as the other person](#working-at-the-same-time-as-the-other-person)
8. [Archiving, restoring and deleting](#archiving-restoring-and-deleting)
9. [The Archive page](#the-archive-page)
10. [Downloading a backup](#downloading-a-backup)
11. [Troubleshooting](#troubleshooting)

---

## Signing in

Open the site address — <https://wsrs-notes.pages.dev> — in your browser. You
will see a **Sign in** page with a single **password** box.

- Enter the password you were given. It is case sensitive. Do not share this password.
- Press **Sign in**.

Once you are in, you stay signed in on that browser for about **90 days**, even
after closing and reopening it. There is no "remember me" box to tick and no
sign‑up form — if you forget the password ask the person who set the site
up.

**Signing out.** There is a **Sign out** button at the top of every page. Use it
if you are on a shared or public computer. Otherwise you can just leave it.

If you get the password wrong several times in a row the site will pause
sign‑in attempts for 15 minutes. Wait it out and try again.

---

## The Active sessions page

This is the home page. It lists every session that is still in planning (i.e.
not archived) in a table with these columns:

| Column | Meaning |
| --- | --- |
| **Title** | The session name. Select it to open the session. |
| **Date** | Whatever was typed in the date box — a full date, "March 2026", or blank. |
| **Date status** | How firm the date is: *Not set*, *Vague*, *Pencilled in*, *Confirmed*. |
| **Session status** | How far along planning is: *Idea*, *Firming up*, *Well formed*, *Ready*, *Archived*. |
| **Type** | What kind of session it is: *To be confirmed*, *Listening session*, *Learning session*. |
| **Last edited** | When it was last saved, and by whom. |

**Sorting.** Every column heading is a button. Select it to sort by that column;
select it again to reverse the order. The page opens sorted by **Last edited**,
newest first, so whatever was touched most recently is at the top. Dates that
are blank or that can't be read as a real date (like "spring 2026") sort to the
bottom.

At the top of the page is a **New session** button. At the foot is a line for
[downloading a backup](#downloading-a-backup).

---

## Creating a session

1. On the Active sessions page, select **New session**.
2. A fresh session page opens straight away, titled *Edit session*, with empty
   fields and a status of *Idea*.
3. Fill in the title and anything else you know, then let it save (see
   [How saving works](#how-saving-works)).

New sessions always start as an *Idea* with no date. Change those on the session
page whenever you like.

---

## A session page

A session page has five short fields at the top, then the notes area, then a
**Save now** button and an **Actions** section.

- **Title** — free text.
- **Date** — free text on purpose. Put whatever you actually know: `14 March
  2026`, `March 2026`, `Spring`, or leave it blank. The app never reformats what
  you type.
- **Date status** — a menu: *Not set*, *Vague*, *Pencilled in*, *Confirmed*.
- **Session status** — a menu: *Idea*, *Firming up*, *Well formed*, *Ready*,
  *Archived*. Setting this to *Archived* moves the session to the Archive page
  (there is also a button for that — see below).
- **Type** — a menu: *To be confirmed*, *Listening session*, *Learning session*.
  New sessions start as *To be confirmed*.

Just below the page heading is a line that tells you the save state and, after a
save, when it was last saved and by whom.

---

## Writing notes

The notes area is where the real content goes — speaker details, contact
addresses and phone numbers, running orders, to‑do lists, and so on. It has two
tabs:

### Write tab

You type in **Markdown**, a light plain‑text way of marking up structure:

| You type | You get |
| --- | --- |
| `## Speaker details` | A heading |
| `- item` (one per line) | A bulleted list |
| `1. item` (one per line) | A numbered list |
| `**important**` | Bold text |
| `[WSRS site](https://wsrs.org.uk)` | A link |

You do not have to remember the syntax. A **toolbar** of buttons sits above the
text box: **Heading**, **Bold**, **Bullet list**, **Numbered list**, **Link**,
**Table**.

- Select some text first, then press a button, and it wraps or prefixes that
  text.
- With nothing selected, the button drops a placeholder in at the cursor for you
  to type over.
- **Table** allows you to convert text to a table or to seed the note area with a simple table: select several lines, each line becoming a row,
  with cells separated by a comma or a tab and the first line used as the header
  row, then press **Table** to turn them into a proper table. With nothing
  selected it inserts a small starter table to fill in.

After any toolbar button, the cursor goes back into the text box so you can keep
typing.

### Preview tab

The **Preview** tab shows the notes rendered properly — real headings, lists and
tables. Switch to it to read the notes back or to check formatting.

**Switching tabs:** select the **Write** or **Preview** tab, or press **F2** to
flip between them.

---

## How saving works

You do not need to think about saving. It happens by itself:

- **About 1.5 seconds after you stop typing.**
- **When you leave a field** (move to another box, or select elsewhere).
- **When you switch away from the tab or close it** — a last‑moment save fires.
- **Whenever you press Save now**, or **Ctrl+S** (Windows) / **Cmd+S** (Mac)
  while the cursor is in the notes box.

The status line under the heading cycles through **Unsaved changes → Saving… →
Saved 14:32 by …**. Routine saves are shown quietly. If a save ever *fails* it
is announced clearly, and your text stays exactly where it is — in the box — so
nothing is lost. Press **Save now** to try again once you are back online.

**Per‑device safety net.** As you type, a private copy is also kept in your own
browser. If you close the page with something unsaved and later reopen that
session on the same device, the app notices and offers **Restore unsaved
changes** or **Discard them** — it will not silently overwrite either version.

---

## Working at the same time as the other person

The app is built for two people and copes with you both being on the same
session at once.

**While a session is open it checks every 15 seconds** for changes the other
person has saved (it pauses while the tab is in the background and catches up the
moment you return to it).

- **If you have no unsaved changes** and they save something, the page quietly
  updates itself to their version and announces *"Updated by … — this page now
  shows the latest version."* You do not need to reload.
- **If you _do_ have unsaved changes**, nothing you have typed is touched.
  Instead a banner appears: *"… has changed this session. Save your changes,
  then reload to see theirs."* Save first, then use the **Reload latest
  version** button.

**If you both saved edits to the same session** and yours lands second, the app
will not overwrite theirs. It stops and offers three choices:

| Choice | What it does |
| --- | --- |
| **Keep mine — replace theirs** | Saves your version over theirs. |
| **Use theirs — discard my changes** | Throws away your unsaved edits and shows their version. |
| **Show both — append theirs** | Keeps your text and pastes theirs underneath, under a `## Conflicted copy` heading, so you can merge the two by hand and then save. |

Nothing is ever merged automatically, and no version is thrown away unless you
pick the option that does so.

If the other person *deletes* a session while you have it open, you are warned
and your text stays in the editor so you can copy anything you still need.

---

## Archiving, restoring and deleting

Every session page has an **Actions** section near the bottom.

- **Archive this session** — sets the status to *Archived* and moves it off the
  Active list onto the [Archive page](#the-archive-page). Nothing is deleted.
- **Restore to active (Ready)** — shown instead when the session is already
  archived. Brings it back to the Active list with the status *Ready*; change
  that on the page if it is not right.
- **Delete this session…** — permanent. It opens a confirmation where you must
  type the word `DELETE` before the **Delete permanently** button works. This
  removes the session and its notes for good, for both of you. There is no undo,
  so [take a backup](#downloading-a-backup) first if you are unsure. Prefer
  **Archive** unless you genuinely want it gone.

---

## The Archive page

Reached from the **Archive** link in the top navigation. It is the same table as
the Active page but showing only archived sessions, and each row has a **Restore
to active** button. Restoring sets the session's status to *Ready* and moves it
back to the Active list.

---

## Downloading a backup

At the foot of the Active sessions page:

> **Download a backup of every session: Markdown · JSON**

Both files contain **every** session, active and archived.

- **Markdown** (`wsrs-notes-YYYY-MM-DD.md`) — the readable copy. One section per
  session with a small details table followed by its notes. Open it in any text
  editor. This is the one to keep and read.
- **JSON** (`wsrs-notes-YYYY-MM-DD.json`) — the machine‑readable copy, holding
  every field. This is the one the site owner would rebuild from if the hosting
  were ever lost.

It is worth downloading one every week or two and keeping it somewhere else —
your own computer or cloud drive — so the notes never live in only one place.

---

## Troubleshooting

**It shows the Sign in page again.** Your 90‑day session has expired, or you are
in a different browser or a private window. Sign in again.

**"Too many attempts."** Too many wrong passwords. Wait 15 minutes.

**A save failed.** You are probably offline. Your text is safe in the box and in
this browser. Reconnect and press **Save now**.

**"… has changed this session" banner.** The other person saved while you had
unsaved edits. Save yours, then select **Reload latest version**.

**A conflict box with three buttons.** You both saved to the same session. Pick
**Keep mine**, **Use theirs**, or **Show both** — see
[Working at the same time](#working-at-the-same-time-as-the-other-person).

**I deleted the wrong session.** Deletion is permanent. Restore it from your
most recent backup download, or re‑enter it by hand.
