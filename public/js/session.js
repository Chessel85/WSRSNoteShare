// One session page (Phase 2).
//
// Structured fields (title, free-text date, date status, session status) plus a
// plain notes textarea, an explicit "Save now" button, an announced save-status
// line, archive / restore, and delete behind a typed confirmation.
//
// Phase 3 replaces the plain textarea with the Markdown editor + autosave.
// Phase 4 expands the 409 handling into the three-way Keep mine / Use theirs /
// Show both choice. For now a conflict is surfaced with a Reload action and
// nothing is overwritten.

import { boot } from "./app.js";
import { api, ApiError } from "./api.js";
import {
  DATE_STATUS_OPTIONS,
  STATUS_OPTIONS,
  formatEdited,
} from "./labels.js";

const params = new URLSearchParams(location.search);
const sessionId = params.get("id");

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
    this.render();
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

    const form = document.createElement("form");
    form.className = "session-form";
    form.noValidate = true;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.save();
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

    // Plain notes textarea for now; the Markdown editor + preview is Phase 3.
    const notesWrap = document.createElement("div");
    notesWrap.className = "field";
    const notesLabel = document.createElement("label");
    notesLabel.htmlFor = "f-notes";
    notesLabel.textContent = "Notes";
    this.notesInput = document.createElement("textarea");
    this.notesInput.id = "f-notes";
    this.notesInput.rows = 16;
    this.notesInput.value = r.notes_md || "";
    notesWrap.append(notesLabel, this.notesInput);
    form.append(notesWrap);

    for (const el of [
      this.titleInput,
      this.dateInput,
      this.dateStatusSelect,
      this.statusSelect,
      this.notesInput,
    ]) {
      el.addEventListener("input", () => this.markDirty());
    }

    // Save status: visible line that is also a polite live region.
    this.status = document.createElement("p");
    this.status.className = "save-status";
    this.status.setAttribute("aria-live", "polite");
    this.setStatus(
      r.updated_at
        ? `Last saved ${formatEdited(r.updated_at)}${
            r.updated_by ? ` by ${r.updated_by}` : ""
          }.`
        : "Not saved yet."
    );

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save now";
    this.saveBtn = saveBtn;

    form.append(this.status, saveBtn);
    this.main.append(form);

    this.renderSideActions();

    h1.focus();
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
      this.save();
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
      'This permanently deletes the session and its notes. Type DELETE to confirm.';

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

  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.setStatus("Unsaved changes.");
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
    this.saving = true;
    this.saveBtn.disabled = true;
    this.setStatus("Saving…");

    const payload = {
      title: this.titleInput.value,
      date_text: this.dateInput.value,
      date_status: this.dateStatusSelect.value,
      status: this.statusSelect.value,
      notes_md: this.notesInput.value,
      version: this.version,
    };

    try {
      const updated = await api.updateSession(sessionId, payload);
      this.record = updated;
      this.version = updated.version;
      this.dirty = false;
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
            ? `Not saved: ${err.message}. Your text is still in the box — press Save now to retry.`
            : "Not saved — your text is still in the box. Press Save now to retry.",
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
    const serverWho = current && current.updated_by ? ` by ${current.updated_by}` : "";
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

// --- small DOM helpers -----------------------------------------------------

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
