// Archived sessions page (Phase 2).
//
// The shared sortable table with archived=1, plus a per-row "Restore to active".

import { boot } from "./app.js";
import { renderSessionsTable } from "./sessions-table.js";

boot((_user, main) => {
  main.textContent = "";

  const h1 = document.createElement("h1");
  h1.textContent = "Archived sessions";
  h1.tabIndex = -1;
  main.append(h1);

  const intro = document.createElement("p");
  intro.textContent =
    "Sessions with status Archived. Restoring one sets its status to Ready; " +
    "adjust it on the session page if needed.";
  main.append(intro);

  const live = document.createElement("p");
  live.className = "sr-live";
  live.setAttribute("aria-live", "polite");
  main.append(live);

  const tableHost = document.createElement("div");
  main.append(tableHost);
  renderSessionsTable(tableHost, { archived: true, liveRegion: live });

  h1.focus();
});
