// Shared page bootstrap: the auth gate plus the common header/nav/sign-out shell.
//
// Each page calls boot() with a render callback that receives the signed-in
// user's display name. If /api/me returns 401, the login view is shown instead
// and the callback runs only after a successful sign-in.

import { api, ApiError } from "./api.js";
import { renderLogin } from "./auth.js";

const NAV_LINKS = [
  { href: "/", text: "Active sessions" },
  { href: "/archive.html", text: "Archive" },
];

export async function boot(render) {
  const main = document.getElementById("main");
  if (!main) throw new Error("Page is missing #main");

  let user;
  try {
    const res = await api.me();
    user = res.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      showLogin(main, render);
      return;
    }
    showFatal(main, err);
    return;
  }

  mountShell(user);
  render(user, main);
}

function showLogin(main, render) {
  clearShell();
  renderLogin(main, (user) => {
    mountShell(user);
    render(user, main);
  });
}

function mountShell(user) {
  clearShell();

  const header = document.querySelector("header");
  if (!header) return;
  header.innerHTML = "";

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Primary");

  const brand = document.createElement("strong");
  brand.textContent = "WSRS Listening Sessions Notes";
  nav.append(brand);

  const list = document.createElement("ul");
  list.className = "nav-links";
  for (const link of NAV_LINKS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.text;
    if (location.pathname === link.href) a.setAttribute("aria-current", "page");
    li.append(a);
    list.append(li);
  }
  nav.append(list);

  const who = document.createElement("span");
  who.className = "signed-in-as";
  who.textContent = `Signed in as ${user}`;

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await api.logout();
    } catch {
      /* clearing the cookie client-side is not possible; reload regardless */
    }
    location.href = "/";
  });

  nav.append(who, signOut);
  header.append(nav);
}

function clearShell() {
  const header = document.querySelector("header");
  if (header) header.innerHTML = "";
}

function showFatal(main, err) {
  main.innerHTML = "";
  const h1 = document.createElement("h1");
  h1.textContent = "This page could not load";
  const p = document.createElement("p");
  p.className = "error";
  p.setAttribute("role", "alert");
  p.textContent =
    err && err.message ? err.message : "An unexpected error occurred.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => location.reload());
  main.append(h1, p, retry);
}
