// Active sessions index page.
//
// Phase 1: just proves the auth gate works — shows who is signed in.
// Phase 2 replaces renderIndex() with the real sortable sessions table.

import { boot } from "./app.js";

boot(renderIndex);

function renderIndex(user, main) {
  main.innerHTML = "";

  const h1 = document.createElement("h1");
  h1.textContent = "Active sessions";
  main.append(h1);

  const p = document.createElement("p");
  p.textContent = `Signed in as ${user}. The sessions list arrives in the next phase.`;
  main.append(p);

  // Move focus to the heading so the page change is announced.
  h1.tabIndex = -1;
  h1.focus();
}
