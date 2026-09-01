// Shared sortable sessions table, used by both the active index and the archive.
//
// A real <table> with <caption>, <th scope="col">, and sortable column headers
// that are <button>s inside the <th> carrying aria-sort. Clicking a header sorts
// by that column; clicking it again reverses the direction.

import {
  dateStatusLabel,
  statusLabel,
  dateSortKey,
  formatEdited,
} from "./labels.js";
import { api, ApiError } from "./api.js";

const COLUMNS = [
  { key: "title", label: "Title" },
  { key: "date_text", label: "Date" },
  { key: "date_status", label: "Date status" },
  { key: "status", label: "Session status" },
  { key: "updated_at", label: "Last edited" },
];

/**
 * @param {HTMLElement} container  where to render
 * @param {object}      opts
 * @param {boolean}     opts.archived   list archived sessions instead of active
 * @param {HTMLElement} opts.liveRegion aria-live element for status messages
 */
export function renderSessionsTable(container, opts) {
  const { archived = false, liveRegion } = opts || {};
  let rows = [];
  let sortKey = "updated_at";
  let sortDir = "desc"; // freshest activity first by default

  const wrap = document.createElement("div");
  container.append(wrap);

  load();

  async function load() {
    wrap.textContent = "";
    const loading = document.createElement("p");
    loading.textContent = "Loading sessions…";
    wrap.append(loading);
    try {
      rows = await api.listSessions(archived);
      draw();
    } catch (err) {
      wrap.textContent = "";
      const p = document.createElement("p");
      p.className = "error";
      p.setAttribute("role", "alert");
      p.textContent =
        err instanceof ApiError
          ? `Could not load sessions: ${err.message}`
          : "Could not load sessions.";
      wrap.append(p);
    }
  }

  function sorted() {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(a, b));
  }

  function compare(a, b) {
    if (sortKey === "date_text") {
      return dateSortKey(a.date_text) - dateSortKey(b.date_text);
    }
    if (sortKey === "updated_at") {
      return (
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      );
    }
    let av = a[sortKey] || "";
    let bv = b[sortKey] || "";
    if (sortKey === "date_status") {
      av = dateStatusLabel(av);
      bv = dateStatusLabel(bv);
    } else if (sortKey === "status") {
      av = statusLabel(av);
      bv = statusLabel(bv);
    }
    return String(av).localeCompare(String(bv), undefined, {
      sensitivity: "base",
    });
  }

  function draw() {
    wrap.textContent = "";

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = archived
        ? "No archived sessions."
        : "No active sessions yet. Use “New session” to add one.";
      wrap.append(empty);
      return;
    }

    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = archived
      ? `Archived sessions (${rows.length})`
      : `Active sessions (${rows.length})`;
    table.append(caption);

    const theadRow = document.createElement("tr");
    for (const col of COLUMNS) {
      const th = document.createElement("th");
      th.scope = "col";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sort-btn";
      btn.textContent = col.label;
      if (sortKey === col.key) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
        btn.append(document.createTextNode(sortDir === "asc" ? " ▲" : " ▼"));
      } else {
        th.setAttribute("aria-sort", "none");
      }
      btn.addEventListener("click", () => {
        if (sortKey === col.key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = col.key;
          sortDir = col.key === "updated_at" ? "desc" : "asc";
        }
        draw();
      });
      th.append(btn);
      theadRow.append(th);
    }
    if (archived) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = "Actions";
      theadRow.append(th);
    }
    const thead = document.createElement("thead");
    thead.append(theadRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    for (const row of sorted()) {
      tbody.append(buildRow(row));
    }
    table.append(tbody);
    wrap.append(table);
  }

  function buildRow(row) {
    const tr = document.createElement("tr");

    const titleCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = `/session?id=${encodeURIComponent(row.id)}`;
    link.textContent = row.title && row.title.trim() ? row.title : "(untitled)";
    titleCell.append(link);
    tr.append(titleCell);

    tr.append(cell(row.date_text && row.date_text.trim() ? row.date_text : "—"));
    tr.append(cell(dateStatusLabel(row.date_status)));
    tr.append(cell(statusLabel(row.status)));

    const editedCell = document.createElement("td");
    editedCell.textContent = row.updated_by
      ? `${formatEdited(row.updated_at)} by ${row.updated_by}`
      : formatEdited(row.updated_at);
    tr.append(editedCell);

    if (archived) {
      const actionCell = document.createElement("td");
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "Restore to active";
      restore.addEventListener("click", () => restoreRow(row, restore));
      actionCell.append(restore);
      tr.append(actionCell);
    }

    return tr;
  }

  async function restoreRow(row, button) {
    button.disabled = true;
    try {
      // Bring back the full record, flip status, write it back with its version.
      const full = await api.getSession(row.id);
      await api.updateSession(row.id, {
        title: full.title,
        date_text: full.date_text,
        date_status: full.date_status,
        status: "ready",
        notes_md: full.notes_md,
        version: full.version,
      });
      rows = rows.filter((r) => r.id !== row.id);
      draw();
      announce(
        `Restored “${row.title || "untitled"}” to active sessions with status Ready.`
      );
    } catch (err) {
      button.disabled = false;
      announce(
        err instanceof ApiError
          ? `Could not restore: ${err.message}`
          : "Could not restore that session.",
        true
      );
    }
  }

  function announce(message, isError) {
    if (!liveRegion) return;
    liveRegion.textContent = "";
    liveRegion.setAttribute("role", isError ? "alert" : "status");
    // Re-set on next frame so repeated identical messages are still announced.
    requestAnimationFrame(() => {
      liveRegion.textContent = message;
    });
  }

  return { reload: load };
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}
