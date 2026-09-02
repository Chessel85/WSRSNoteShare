// Markdown notes editor (Phase 3).
//
// A plain <textarea> containing Markdown, a formatting toolbar of real buttons,
// and a Write / Preview tab pair. The rendered preview is real semantic HTML
// (<h2>, <ul>, <table> …) so NVDA quick-nav (H, L, T) works there exactly as
// expected — quick-nav cannot work inside any editable region, so it only
// exists in the read view. See the implementation plan §5.
//
// marked + DOMPurify are loaded as classic scripts in session.html and appear
// on window.  The preview HTML is ALWAYS run through DOMPurify before it is
// inserted: the authors are trusted, pasted content is not.
//
// This module owns only the notes editing surface. Save orchestration
// (debounce, blur, pagehide, conflicts, the status line) lives in session.js,
// which passes an onInput callback fired for both typing and toolbar edits.

const TOGGLE_HINT = "Press Ctrl+Shift+P to switch between Write and Preview.";

export class MarkdownEditor {
  // container: element to build into
  // id: DOM id for the textarea (so an external <label>/hint can point at it)
  // value: initial Markdown
  // onInput: called on every content change (typing or toolbar)
  // onSaveShortcut: called on Ctrl+S / Cmd+S inside the editor
  constructor(container, { id, value = "", onInput, onSaveShortcut }) {
    this.id = id;
    this.onInput = onInput || (() => {});
    this.onSaveShortcut = onSaveShortcut || (() => {});
    this._build(container, value);
  }

  get value() {
    return this.textarea.value;
  }

  set value(v) {
    this.textarea.value = v || "";
    if (!this.previewPanel.hidden) this._renderPreview();
  }

  focus() {
    this._selectTab(this.writeTab, { focus: true });
  }

  // -----------------------------------------------------------------------

  _build(container, value) {
    const root = document.createElement("div");
    root.className = "md-editor";

    // --- tablist ---------------------------------------------------------
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Notes editor mode");
    tablist.className = "md-tabs";

    this.writeTab = this._makeTab("Write", "md-panel-write", true);
    this.previewTab = this._makeTab("Preview", "md-panel-preview", false);
    tablist.append(this.writeTab, this.previewTab);

    tablist.addEventListener("keydown", (e) => this._onTablistKeydown(e));
    this.writeTab.addEventListener("click", () =>
      this._selectTab(this.writeTab, { focus: true })
    );
    this.previewTab.addEventListener("click", () =>
      this._selectTab(this.previewTab, { focus: true })
    );

    // --- write panel ---------------------------------------------------
    this.writePanel = document.createElement("div");
    this.writePanel.id = "md-panel-write";
    this.writePanel.setAttribute("role", "tabpanel");
    this.writePanel.setAttribute("aria-labelledby", this.writeTab.id);

    this.writePanel.append(this._buildToolbar());

    const label = document.createElement("label");
    label.htmlFor = this.id;
    label.className = "md-textarea-label";
    label.textContent = "Notes (Markdown)";

    this.textarea = document.createElement("textarea");
    this.textarea.id = this.id;
    this.textarea.className = "md-textarea";
    this.textarea.rows = 18;
    this.textarea.spellcheck = true;
    this.textarea.value = value || "";
    // Deliberately NOT intercepting Tab — that is a WCAG 2.1.2 keyboard trap.

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.id = `${this.id}-hint`;
    hint.textContent =
      `Markdown syntax. ${TOGGLE_HINT} ` +
      "Heading / list / table quick-navigation works in the Preview tab.";
    this.textarea.setAttribute("aria-describedby", hint.id);

    this.textarea.addEventListener("input", () => this._emitInput());
    this.textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.onSaveShortcut();
      }
    });

    this.writePanel.append(label, this.textarea, hint);

    // --- preview panel -----------------------------------------------
    this.previewPanel = document.createElement("div");
    this.previewPanel.id = "md-panel-preview";
    this.previewPanel.setAttribute("role", "tabpanel");
    this.previewPanel.setAttribute("aria-labelledby", this.previewTab.id);
    this.previewPanel.hidden = true;

    this.preview = document.createElement("div");
    this.preview.className = "md-preview";
    this.preview.tabIndex = 0; // scrollable region → focusable (WCAG 2.1.1)
    this.previewPanel.append(this.preview);

    root.append(tablist, this.writePanel, this.previewPanel);

    // Ctrl+Shift+P toggles from anywhere inside the editor.
    root.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        const next =
          this.writeTab.getAttribute("aria-selected") === "true"
            ? this.previewTab
            : this.writeTab;
        this._selectTab(next, { focus: true });
      }
    });

    container.append(root);
  }

  _makeTab(text, controls, selected) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `md-tab-${controls}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", controls);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
    tab.className = "md-tab";
    tab.textContent = text;
    return tab;
  }

  _onTablistKeydown(e) {
    const tabs = [this.writeTab, this.previewTab];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    this._selectTab(next, { focus: true });
  }

  _selectTab(tab, { focus } = {}) {
    const isPreview = tab === this.previewTab;
    for (const t of [this.writeTab, this.previewTab]) {
      const on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    }
    this.writePanel.hidden = isPreview;
    this.previewPanel.hidden = !isPreview;
    if (isPreview) this._renderPreview();
    if (focus) (isPreview ? this.preview : this.textarea).focus();
  }

  _renderPreview() {
    const md = this.textarea.value;
    let html;
    try {
      html = window.marked.parse(md, { breaks: false, gfm: true });
    } catch {
      html = "";
    }
    const clean = window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
    });
    this.preview.innerHTML = clean;
    if (!md.trim()) {
      this.preview.innerHTML =
        '<p class="md-preview-empty">Nothing to preview yet.</p>';
      return;
    }
    // GFM emits bare <th>; NVDA table quick-nav is happiest with scope set.
    for (const th of this.preview.querySelectorAll("thead th")) {
      th.setAttribute("scope", "col");
    }
  }

  _emitInput() {
    if (!this.previewPanel.hidden) this._renderPreview();
    this.onInput(this.textarea.value);
  }

  // --- toolbar ---------------------------------------------------------

  _buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "md-toolbar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Markdown formatting");

    const actions = [
      ["Heading", () => this._prefixLines("## ")],
      ["Bold", () => this._wrap("**", "**", "bold text")],
      ["Bullet list", () => this._prefixLines("- ")],
      ["Numbered list", () => this._numberLines()],
      ["Link", () => this._insertLink()],
      ["Table", () => this._insertTable()],
    ];
    for (const [name, fn] of actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "md-tool";
      b.textContent = name;
      b.addEventListener("click", () => {
        fn();
        this.textarea.focus();
        this._emitInput();
      });
      bar.append(b);
    }
    return bar;
  }

  _field() {
    const ta = this.textarea;
    return { start: ta.selectionStart, end: ta.selectionEnd, value: ta.value };
  }

  _setValue(next, selStart, selEnd) {
    const ta = this.textarea;
    ta.value = next;
    ta.selectionStart = selStart;
    ta.selectionEnd = selEnd == null ? selStart : selEnd;
  }

  _wrap(before, after, placeholder) {
    const { start, end, value } = this._field();
    const sel = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + before + sel + after + value.slice(end);
    this._setValue(next, start + before.length, start + before.length + sel.length);
  }

  // Prefix every line touched by the selection with `prefix`.
  _prefixLines(prefix) {
    const { start, end, value } = this._field();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const replaced = block
      .split("\n")
      .map((l) => (l.startsWith(prefix) ? l : prefix + l))
      .join("\n");
    const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    this._setValue(next, lineStart, lineStart + replaced.length);
  }

  _numberLines() {
    const { start, end, value } = this._field();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const replaced = block
      .split("\n")
      .map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s+/, "")}`)
      .join("\n");
    const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
    this._setValue(next, lineStart, lineStart + replaced.length);
  }

  _insertLink() {
    const { start, end, value } = this._field();
    const text = value.slice(start, end) || "link text";
    const snippet = `[${text}](https://)`;
    const next = value.slice(0, start) + snippet + value.slice(end);
    // Place the caret inside the (https://) URL slot.
    const urlAt = start + text.length + 3;
    this._setValue(next, urlAt, urlAt + 8);
  }

  _insertTable() {
    const { start, value } = this._field();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const atLineStart = start === lineStart;
    const table =
      (atLineStart ? "" : "\n") +
      "| Column A | Column B |\n" +
      "| --- | --- |\n" +
      "| Cell 1 | Cell 2 |\n" +
      "| Cell 3 | Cell 4 |\n";
    const next = value.slice(0, start) + table + value.slice(start);
    const caret = start + table.length;
    this._setValue(next, caret, caret);
  }
}
