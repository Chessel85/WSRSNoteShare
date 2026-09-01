// One session page.
//
// Phase 1: auth-gate placeholder. Phases 2-4 add the structured fields, the
// Markdown editor, autosave, conflict handling, and version polling.

import { boot } from "./app.js";

boot((user, main) => {
  main.innerHTML = "";
  const h1 = document.createElement("h1");
  h1.textContent = "Session";
  main.append(h1);
  const p = document.createElement("p");
  p.textContent = `Signed in as ${user}. The session editor arrives in a later phase.`;
  main.append(p);
  h1.tabIndex = -1;
  h1.focus();
});
