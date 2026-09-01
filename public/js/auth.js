// Login view. Rendered into a container whenever /api/me returns 401.
//
// One labelled passphrase field, a submit button, errors in role="alert".
// On success it calls onSuccess(user) so the caller can swap in the app.

import { api, ApiError } from "./api.js";

export function renderLogin(container, onSuccess) {
  container.innerHTML = "";

  const h1 = document.createElement("h1");
  h1.textContent = "Sign in";
  container.append(h1);

  const p = document.createElement("p");
  p.textContent =
    "Enter your passphrase. If you do not have one, ask the person who set this up.";
  container.append(p);

  const form = document.createElement("form");
  form.noValidate = true;

  const label = document.createElement("label");
  label.htmlFor = "passphrase";
  label.textContent = "Passphrase";

  const input = document.createElement("input");
  input.type = "password";
  input.id = "passphrase";
  input.name = "passphrase";
  input.autocomplete = "current-password";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.required = true;
  input.setAttribute("aria-describedby", "passphrase-error");

  const errorBox = document.createElement("p");
  errorBox.id = "passphrase-error";
  errorBox.className = "error";
  errorBox.hidden = true;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Sign in";

  form.append(label, input, errorBox, submit);
  container.append(form);

  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    errorBox.removeAttribute("role");

    const value = input.value;
    if (!value) {
      showError("Enter your passphrase.");
      return;
    }

    submit.disabled = true;
    const previousLabel = submit.textContent;
    submit.textContent = "Signing in…";

    try {
      const { user } = await api.login(value);
      onSuccess(user);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try again.";
      showError(message);
      input.focus();
      input.select();
    } finally {
      submit.disabled = false;
      submit.textContent = previousLabel;
    }
  });

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    // role set after content so screen readers announce the fresh text.
    errorBox.setAttribute("role", "alert");
  }
}
