// One session page (Phases 2–3).
//
// Structured fields (title, free-text date, date status, session status) plus
// the Markdown notes editor (see editor.js), an explicit "Save now" button, an
// announced save-status line, archive / restore, and delete behind a typed
// confirmation.
//
// Phase 3 adds the real saving machinery the requirements call for:
//   1. debounced autosave 1500 ms after typing stops
//   2. save on blur of any field / the editor, and when the tab is hidden
//   3. a `pagehide` keepalive backstop
//   4. the explicit "Save now" button (and Ctrl+S in the editor)
//   5. a per-device localStorage draft mirrored on every keystroke, offered
//      back on load when it is newer than and differs from the server copy
//
// Phase 4 expands the 409 handling into the three-way Keep mine / Use theirs /
// Show both choice. For now a conflict is surfaced with a Reload action and
// nothing is overwritten.

import { boot } from "./app.js";
import { api, ApiError } from "./api.js";
import { MarkdownEditor } from "./editor.js";
import {
  DATE_STATUS_OPTIONS,
  STATUS_OPTIONS,
  formatEdited,
} from "./labels.js";

const params = new URLSearchParams(location.search);
const sessionId = params.get("id");

const AUTOSAVE_MS = 1500;
const KEEPALIVE_MAX_BYTES = 60 * 1024; // keepalive bodies are capped near 64 KB
const DRAFT_PREFIX = "wsrs-draft:";
const DRAFT_FIELDS = ["title", "date_text", "date_status", "status", "notes_md"];

boot((user, main) => {
  if (!sessionId) {
    renderMissingId(main);
    return;
  }
  new SessionPage(user, main).init();
});

function renderMissingId(main) {
  main.textContent = "";
  const h1 = document.createElement("h1");
  h1.textContent = "Session not found";
  const p = document.createElement("p");
  p.className = "error";
  p.setAttribute("role", "alert");
  p.textContent = "No session was specified.";
  const back = document.createElement("a");
  back.href = "/";
  back.textContent = "Back to active sessions";
  main.append(h1, p, back);
  h1.tabIndex = -1;
  h1.focus();
}

class SessionPage {
  constructor(user, main) {
    this.user = user;
    this.main = main;
    this.record = null;
    this.version = null;
    this.dirty = false;
    this.saving = false;
    this.autosaveTimer = null;
    this.pendingDraft = null;
  }

  async init() {
    this.main.textContent = "";
    const loading = document.createElement("p");
    loading.textContent = "Loading session…";
    this.main.append(loading);

    try {
      this.record = await api.getSession(sessionId);
      this.version = this.record.version;
    } catch (err) {
      this.renderLoadError(err);
      return;
    }

    const draft = readDraft(sessionId);
    if (
      draft &&
      draftDiffers(draft, this.record) &&
      draft.ts > (Date.parse(this.record.updated_at) || 0)
    ) {
      this.pendingDraft = draft;
    } else if (draft) {
      // Stale or identical — clear it so it cannot resurface later.
      clearDraft(sessionId);
    }

    this.render();
    this.installBackstops();
  }

  renderLoadError(err) {
    this.main.textContent = "";
    const h1 = document.createElement("h1");
    h1.textContent = "Could not load this session";
    const p = document.createElement("p");
    p.className = "error";
    p.setAttribute("role", "alert");
    p.textContent =
      err instanceof ApiError && err.status === 404
        ? "That session does not exist. It may have been deleted."
        : err instanceof ApiError
        ? err.message
        : "An unexpected error occurred.";
    const back = document.createElement("a");
    back.href = "/";
    back.textContent = "Back to active sessions";
    this.main.append(h1, p, back);
    h1.tabIndex = -1;
    h1.focus();
  }

  render() {
    const r = this.record;
    this.main.textContent = "";

    const h1 = document.createElement("h1");
    h1.textContent = "Edit session";
    h1.tabIndex = -1;
    this.main.append(h1);

    document.title = `${r.title || "Untitled session"} — WSRS Listening Sessions Notes`;

    if (this.pendingDraft) this.renderDraftBanner();

    const form = document.createElement("form");
    form.className = "session-form";
    form.noValidate = true;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.saveNow();
    });

    this.titleInput = field(form, {
      id: "f-title",
      label: "Title",
      value: r.title,
    });
    this.dateInput = field(form, {
      id: "f-date",
      label: "Date",
      value: r.date_text,
      hint: 'Free text — leave blank, or e.g. “March 2026” or “14 March 2026”.',
    });
    this.dateStatusSelect = selectField(form, {
      id: "f-date-status",
      label: "Date status",
      value: r.date_status,
      options: DATE_STATUS_OPTIONS,
    });
    this.statusSelect = selectField(form, {
      id: "f-status",
      label: "Session status",
      value: r.status,
      options: STATUS_OPTIONS,
    });

    // Markdown editor: textarea + toolbar + sanitised preview.
    const editorWrap = document.createElement("div");
    editorWrap.className = "field";
    form.append(editorWrap);
    this.editor = new MarkdownEditor(editorWrap, {
      id: "f-notes",
      value: r.notes_md || "",
      onInput: () => this.markDirty(),
      onSaveShortcut: () => this.saveNow(),
    });

    for (const el of [
      this.titleInput,
      this.dateInput,
      this.dateStatusSelect,
      this.statusSelect,
    ]) {
      el.addEventListener("input", () => this.markDirty());
      el.addEventListener("blur", () => this.flushSave());
    }
    this.editor.textarea.addEventListener("blur", () => this.flushSave());

    // Save status: visible line that is also a polite live region.
    this.status = document.createElement("p");
    this.status.className = "save-status";
    this.status.setAttribute("aria-live", "polite");
    this.baselineStatus();

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save now";
    this.saveBtn = saveBtn;

    form.append(this.status, saveBtn);
    this.main.append(form);

    this.renderSideActions();

    if (this.pendingDraft) {
      this.draftBanner.querySelector("button").focus();
    } else {
      h1.focus();
    }
  }

  baselineStatus() {
    const r = this.record;
    this.setStatus(
      r.updated_at
        ? `Last saved ${formatEdited(r.updated_at)}${
            r.updated_by ? ` by ${r.updated_by}` : ""
          }.`
        : "Not saved yet."
    );
  }

  renderDraftBanner() {
    const banner = document.createElement("div");
    banner.className = "draft-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Unsaved changes on this device");

    const p = document.createElement("p");
    p.textContent =
      "Unsaved changes from this device were found for this session, newer " +
      "than the saved copy. Restore them into the editor, or discard them?";

    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore unsaved changes";

    const discard = document.createElement("button");
    discard.type = "button";
    discard.textContent = "Discard them";

    restore.addEventListener("click", () => {
      const d = this.pendingDraft;
      this.titleInput.value = d.title || "";
      this.dateInput.value = d.date_text || "";
      this.dateStatusSelect.value = d.date_status || this.record.date_status;
      this.statusSelect.value = d.status || this.record.status;
      this.editor.value = d.notes_md || "";
      this.pendingDraft = null;
      banner.remove();
      this.markDirty();
      this.setStatus("Unsaved changes restored from this device. Not saved yet.");
      this.editor.focus();
    });

    discard.addEventListener("click", () => {
      clearDraft(sessionId);
      this.pendingDraft = null;
      banner.remove();
      this.baselineStatus();
      this.titleInput.focus();
    });

    banner.append(p, restore, discard);
    this.draftBanner = banner;
    this.main.append(banner);
  }

  renderSideActions() {
    const section = document.createElement("section");
    section.setAttribute("aria-label", "Session actions");
    section.className = "session-actions";

    const h2 = document.createElement("h2");
    h2.textContent = "Actions";
    section.append(h2);

    // Archive / restore toggles on the current status.
    const archiveBtn = document.createElement("button");
    archiveBtn.type = "button";
    const isArchived = this.record.status === "archived";
    archiveBtn.textContent = isArchived
      ? "Restore to active (Ready)"
      : "Archive this session";
    archiveBtn.addEventListener("click", () => {
      this.statusSelect.value = isArchived ? "ready" : "archived";
      this.markDirty();
      this.saveNow();
    });
    section.append(archiveBtn);

    // Delete behind a typed confirmation.
    const deleteWrap = document.createElement("div");
    deleteWrap.className = "danger-zone";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Delete this session…";
    deleteBtn.addEventListener("click", () =>
      this.showDeleteConfirm(deleteWrap, deleteBtn)
    );
    deleteWrap.append(deleteBtn);
    section.append(deleteWrap);

    this.main.append(section);
  }

  showDeleteConfirm(wrap, triggerBtn) {
    triggerBtn.hidden = true;
    const box = document.createElement("div");
    box.className = "confirm-box";

    const p = document.createElement("p");
    p.id = "del-help";
    p.textContent =
      "This permanently deletes the session and its notes. Type DELETE to confirm.";

    const label = document.createElement("label");
    label.htmlFor = "del-confirm";
    label.textContent = "Type DELETE";

    const input = document.createElement("input");
    input.type = "text";
    input.id = "del-confirm";
    input.autocomplete = "off";
    input.setAttribute("aria-describedby", "del-help");

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "danger";
    confirm.textContent = "Delete permanently";
    confirm.disabled = true;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";

    input.addEventListener("input", () => {
      confirm.disabled = input.value.trim() !== "DELETE";
    });
    cancel.addEventListener("click", () => {
      box.remove();
      triggerBtn.hidden = false;
      triggerBtn.focus();
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      try {
        await api.deleteSession(sessionId);
        clearDraft(sessionId);
        this.dirty = false; // stop the pagehide backstop resurrecting it
        location.href = "/";
      } catch (err) {
        confirm.disabled = false;
        cancel.disabled = false;
        this.setStatus(
          err instanceof ApiError
            ? `Could not delete: ${err.message}`
            : "Could not delete this session.",
          true
        );
      }
    });

    box.append(p, label, input, confirm, cancel);
    wrap.append(box);
    input.focus();
  }

  // --- dirty tracking, drafts, autosave --------------------------------

  currentPayload() {
    return {
      title: this.titleInput.value,
      date_text: this.dateInput.value,
      date_status: this.dateStatusSelect.value,
      status: this.statusSelect.value,
      notes_md: this.editor ? this.editor.value : this.record.notes_md,
      version: this.version,
    };
  }

  markDirty() {
    // The local draft is mirrored on every keystroke — cheap, synchronous, and
    // survives a crashed tab or dead network.
    writeDraft(sessionId, this.currentPayload());

    if (!this.dirty) {
      this.dirty = true;
      this.setStatus("Unsaved changes.");
    }
    this.scheduleAutosave();
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.save(), AUTOSAVE_MS);
  }

  // Blur / navigation: save straight away rather than waiting out the debounce.
  flushSave() {
    if (!this.dirty || this.saving) return;
    clearTimeout(this.autosaveTimer);
    this.save();
  }

  saveNow() {
    clearTimeout(this.autosaveTimer);
    this.save();
  }

  installBackstops() {
    // Tab hidden (app switch, navigation): a normal async save still has time.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushSave();
    });

    // Final backstop as the page goes away. `pagehide`, not `beforeunload`:
    // beforeunload cannot reliably await async work and Safari is inconsistent.
    window.addEventListener("pagehide", () => {
      if (!this.dirty || this.saving) return;
      const payload = this.currentPayload();
      const body = JSON.stringify(payload);
      if (byteLength(body) > KEEPALIVE_MAX_BYTES) return; // draft still holds it
      try {
        fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
          credentials: "same-origin",
        });
      } catch {
        /* nothing more we can do here; the local draft remains */
      }
    });
  }

  setStatus(message, isError) {
    if (!this.status) return;
    this.status.textContent = message;
    if (isError) this.status.setAttribute("role", "alert");
    else this.status.removeAttribute("role");
    this.status.classList.toggle("error", !!isError);
  }

  async save() {
    if (this.saving) return;
    if (!this.dirty) return;
    this.saving = true;
    this.saveBtn.disabled = true;
    this.setStatus("Saving…");

    const payload = this.currentPayload();

    try {
      const updated = await api.updateSession(sessionId, payload);
      this.record = updated;
      this.version = updated.version;
      this.dirty = false;
      clearDraft(sessionId);
      document.title = `${updated.title || "Untitled session"} — WSRS Listening Sessions Notes`;
      this.setStatus(
        `Saved ${formatEdited(updated.updated_at)}${
          updated.updated_by ? ` by ${updated.updated_by}` : ""
        }.`
      );
      this.refreshArchiveButton();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        this.handleConflict(err.body && err.body.current);
      } else {
        this.setStatus(
          err instanceof ApiError
            ? `Not saved: ${err.message}. Your text is still in the box and on ` +
                "this device — press Save now to retry."
            : "Not saved — your text is still in the box and on this device. " +
                "Press Save now to retry.",
          true
        );
      }
    } finally {
      this.saving = false;
      this.saveBtn.disabled = false;
    }
  }

  refreshArchiveButton() {
    // Rebuild the actions section so Archive/Restore reflects the new status.
    const old = this.main.querySelector(".session-actions");
    if (old) old.remove();
    this.renderSideActions();
  }

  handleConflict(current) {
    const serverWhen = current ? formatEdited(current.updated_at) : "just now";
    const serverWho =
      current && current.updated_by ? ` by ${current.updated_by}` : "";
    this.setStatus(
      `This session was changed elsewhere ${serverWhen}${serverWho}. ` +
        "Your text is still in the box. Reload to see the current version, " +
        "then reapply your changes.",
      true
    );

    // A focusable Reload control next to the status line.
    if (this.main.querySelector(".conflict-reload")) return;
    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "conflict-reload";
    reload.textContent = "Reload latest version";
    reload.addEventListener("click", () => location.reload());
    this.status.after(reload);
    reload.focus();
  }
}

// --- local draft store ---------------------------------------------------

function draftKey(id) {
  return DRAFT_PREFIX + id;
}

function readDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.ts !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(id, payload) {
  try {
    const draft = { ts: Date.now() };
    for (const k of DRAFT_FIELDS) draft[k] = payload[k];
    localStorage.setItem(draftKey(id), JSON.stringify(draft));
  } catch {
    /* storage full or unavailable — the in-memory textarea is still the truth */
  }
}

function clearDraft(id) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

function draftDiffers(draft, record) {
  return DRAFT_FIELDS.some((k) => (draft[k] || "") !== (record[k] || ""));
}

// --- small DOM helpers -------------------------------------------------

function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

function field(form, { id, label, value, hint }) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  wrap.append(labelEl);

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.value = value || "";

  if (hint) {
    const hintEl = document.createElement("p");
    hintEl.id = `${id}-hint`;
    hintEl.className = "hint";
    hintEl.textContent = hint;
    input.setAttribute("aria-describedby", hintEl.id);
    wrap.append(input, hintEl);
  } else {
    wrap.append(input);
  }

  form.append(wrap);
  return input;
}

function selectField(form, { id, label, value, options }) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  const select = document.createElement("select");
  select.id = id;
  for (const [optValue, optLabel] of options) {
    const opt = document.createElement("option");
    opt.value = optValue;
    opt.textContent = optLabel;
    if (optValue === value) opt.selected = true;
    select.append(opt);
  }

  wrap.append(labelEl, select);
  form.append(wrap);
  return select;
}
