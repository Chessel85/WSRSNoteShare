// Active sessions index page (Phase 2).
//
// A "New session" button plus the shared sortable table of non-archived sessions.

import { boot } from "./app.js";
import { api, ApiError } from "./api.js";
import { renderSessionsTable } from "./sessions-table.js";

boot(renderIndex);

function renderIndex(_user, main) {
  main.textContent = "";

  const h1 = document.createElement("h1");
  h1.textContent = "Active sessions";
  h1.tabIndex = -1;
  main.append(h1);

  const live = document.createElement("p");
  live.className = "sr-live";
  live.setAttribute("aria-live", "polite");
  main.append(live);

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.textContent = "New session";
  toolbar.append(newBtn);
  main.append(toolbar);

  const tableHost = document.createElement("div");
  main.append(tableHost);
  renderSessionsTable(tableHost, { archived: false, liveRegion: live });

  // Phase 5: the backup escape hatch. Plain links — the server sends the file
  // as a download (Content-Disposition), so no script is involved.
  const exportP = document.createElement("p");
  exportP.className = "export-links";
  const exportLabel = document.createElement("span");
  exportLabel.textContent = "Download a backup of every session: ";
  const mdLink = document.createElement("a");
  mdLink.href = "/api/export?format=md";
  mdLink.textContent = "Markdown";
  mdLink.setAttribute("download", "");
  const jsonLink = document.createElement("a");
  jsonLink.href = "/api/export?format=json";
  jsonLink.textContent = "JSON";
  jsonLink.setAttribute("download", "");
  exportP.append(exportLabel, mdLink, document.createTextNode(" · "), jsonLink);
  main.append(exportP);

  newBtn.addEventListener("click", async () => {
    newBtn.disabled = true;
    const previous = newBtn.textContent;
    newBtn.textContent = "Creating…";
    try {
      const record = await api.createSession("");
      // Focus lands on the new session's <h1> once that page loads.
      location.href = `/session?id=${encodeURIComponent(record.id)}`;
    } catch (err) {
      newBtn.disabled = false;
      newBtn.textContent = previous;
      live.setAttribute("role", "alert");
      live.textContent =
        err instanceof ApiError
          ? `Could not create a session: ${err.message}`
          : "Could not create a session.";
    }
  });

  h1.focus();
}
