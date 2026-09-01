// Archived sessions page.
//
// Phase 1: auth-gate placeholder. Phase 2 renders the archived sessions table
// (shared table code with the active index) plus "Restore to active".

import { boot } from "./app.js";

boot((user, main) => {
  main.innerHTML = "";
  const h1 = document.createElement("h1");
  h1.textContent = "Archived sessions";
  main.append(h1);
  const p = document.createElement("p");
  p.textContent = `Signed in as ${user}. The archive list arrives in the next phase.`;
  main.append(p);
  h1.tabIndex = -1;
  h1.focus();
});
