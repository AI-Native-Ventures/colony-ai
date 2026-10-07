/**
 * Fixed, internal page functions run through `Runtime.callFunctionOn` in an
 * ISOLATED world (see page-driver.mjs). They are constants: no agent supplied
 * text is ever concatenated into one, and the driver refuses to run any
 * declaration that is not in this table. In an isolated world the page cannot
 * override the built-ins these functions rely on.
 *
 * The fixture spec exercises these functions in real Electron Chromium.
 * Packaged runtime and live agent proof remain separate gates.
 */

import {
  CREDENTIAL_AUTOCOMPLETE,
  CREDENTIAL_NAME,
  CONFUSABLES,
} from "./classifier.mjs";

import { INVISIBLE } from "./redaction.mjs";

export const FUNCTIONS = Object.freeze({
  /** this = element. Facts the classifier needs, as plain JSON. */
  describe: `function () {
    const text = (value, max) => String(value == null ? "" : value).replace(/\\s+/g, " ").trim().slice(0, max);
    const el = this;
    const tag = (el.tagName || "").toLowerCase();
    const attr = (node, name) => (node.getAttribute ? node.getAttribute(name) : null);
    const labelOf = (node) => {
      const parts = [];
      if (node.labels) for (const l of node.labels) parts.push(l.textContent);
      parts.push(attr(node, "aria-label"), attr(node, "placeholder"), attr(node, "name"), attr(node, "id"));
      return text(parts.filter(Boolean).join(" "), 120);
    };
    const form = el.form || (el.closest ? el.closest("form") : null);
    const dialog = el.closest ? el.closest("dialog, [role=dialog], [role=alertdialog]") : null;
    const fieldsOf = (formEl) => {
      const out = [];
      for (const f of formEl.elements || []) {
        const ftag = (f.tagName || "").toLowerCase();
        if (!["input", "select", "textarea"].includes(ftag)) continue;
        out.push({
          role: ftag === "input" ? "textbox" : ftag === "select" ? "combobox" : "textbox",
          inputType: f.type ? String(f.type).toLowerCase() : undefined,
          autocomplete: attr(f, "autocomplete") || undefined,
          name: labelOf(f),
        });
        if (out.length >= 60) break;
      }
      return out;
    };
    let formAction = null;
    if (form) {
      try { formAction = new URL(attr(form, "action") || location.href, location.href).href; } catch (e) { formAction = null; }
    }
    const href = tag === "a" ? attr(el, "href") : null;
    return {
      tag,
      inputType: tag === "input" ? String(el.type || "").toLowerCase() : undefined,
      buttonType: tag === "button" ? String(el.type || "submit").toLowerCase() : undefined,
      autocomplete: attr(el, "autocomplete") || undefined,
      href: href == null ? undefined : text(href, 500),
      label: labelOf(el),
      inDialog: Boolean(dialog),
      dialogRole: dialog ? (attr(dialog, "role") || "dialog") : undefined,
      dialogText: dialog ? text(dialog.textContent, 300) : undefined,
      form: form ? { action: formAction, method: String(form.method || "get").toLowerCase(), fields: fieldsOf(form) } : null,
    };
  }`,

  /** this = element, args [x, y]. True when the point hits the element. */
  hitTest: `function (x, y) {
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit) && (hit === this || this.contains(hit));
  }`,

  /** this = element. Focus and select the current contents so typing replaces them. */
  selectContents: `function () {
    this.focus();
    if (typeof this.select === "function") { this.select(); return true; }
    if (this.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(this);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    return false;
  }`,

  /** this = select element, args [values]. Choose options by value or label. */
  selectOptions: `function (values) {
    if (String(this.tagName).toLowerCase() !== "select") return { ok: false };
    const wanted = new Set(values.map(String));
    let count = 0;
    for (const option of this.options) {
      const match = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.text);
      option.selected = match && (this.multiple || count === 0);
      if (option.selected) count += 1;
    }
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: count > 0, count };
  }`,

  /** this = document or element, args [max]. Visible text, bounded. */
  readText: `function (max) {
    const node = this.nodeType === 9 ? (this.body || this.documentElement) : this;
    const value = node && (node.innerText != null ? node.innerText : node.textContent);
    return String(value == null ? "" : value).slice(0, max);
  }`,

  /** this = document, args [needle]. Does the page text contain it? */
  pageHasText: `function (needle) {
    const node = this.body || this.documentElement;
    return Boolean(node) && String(node.innerText || "").includes(needle);
  }`,

  /** this = document, args [direction]. Scroll the page to an edge. */
  scrollPageTo: `function (direction) {
    const root = this.scrollingElement || this.documentElement;
    window.scrollTo({ top: direction === "bottom" ? root.scrollHeight : 0, behavior: "instant" });
    return true;
  }`,

  /** this = element or document. True when a node with the ref is still connected. */
  isConnected: `function () { return Boolean(this.isConnected); }`,

  /** this = document. Hide credential and card inputs for a screenshot. */
  maskCredentials: `function () {
    const sensitive = new Set(${JSON.stringify([...CREDENTIAL_AUTOCOMPLETE])});
    const credentialName = new RegExp(${JSON.stringify(CREDENTIAL_NAME.source)}, "iu");
    const folds = ${JSON.stringify(Object.fromEntries(CONFUSABLES))};
    let count = 0;
    const fields = this.querySelectorAll("input, textarea");
    if (fields.length > 10000) throw new Error("Too many fields to mask");
    for (const input of fields) {
      const type = String(input.type || "").toLowerCase();
      const tokens = String(input.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/);
      if ((input.labels?.length || 0) > 64) throw new Error("Too many field labels");
      const names = [...Array.from(input.labels || [], (label) => String(label.textContent || "").slice(0, 1000))];
      for (const attr of ["aria-label", "placeholder", "name", "id"]) names.push(input.getAttribute(attr));
      for (const id of String(input.getAttribute("aria-labelledby") || "").split(/\\s+/)) {
        names.push(this.getElementById?.(id)?.textContent);
      }
      const label = names.filter(Boolean).join(" ").normalize("NFKC").replace(new RegExp(${JSON.stringify(INVISIBLE.source)}, "gu"), "").toLowerCase();
      const folded = Array.from(label, (character) => folds[character] || character).join("");
      if (type === "password" || tokens.some((token) => sensitive.has(token)) || credentialName.test(folded)) {
        if (!("__colonyMask" in input)) {
          input.__colonyMask = { value: input.style.getPropertyValue("visibility"), priority: input.style.getPropertyPriority("visibility") };
          input.style.setProperty("visibility", "hidden", "important");
          count += 1;
        }
      }
    }
    return count;
  }`,

  /** this = document. Undo maskCredentials exactly. */
  unmaskCredentials: `function () {
    for (const input of this.querySelectorAll("input, textarea")) {
      if ("__colonyMask" in input) {
        const previous = input.__colonyMask;
        if (previous.value) input.style.setProperty("visibility", previous.value, previous.priority); else input.style.removeProperty("visibility");
        delete input.__colonyMask;
      }
    }
    return true;
  }`,
});

/** Every declaration the driver may run. Anything else is refused. */
export const ALLOWED_FUNCTION_DECLARATIONS = new Set(Object.values(FUNCTIONS));

/**
 * The only CDP methods the driver may send. No Network, Storage, Fetch, Target,
 * Browser, Emulation or Runtime.evaluate: agents never reach cookies, storage,
 * credentials, headers or arbitrary script.
 */
export const ALLOWED_CDP_METHODS = new Set([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.resolveNode",
  "DOM.getBoxModel",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.focus",
  "DOM.setFileInputFiles",
  "Input.dispatchMouseEvent",
  "Input.insertText",
  "Input.dispatchKeyEvent",
  "Page.enable",
  "Page.getFrameTree",
  "Page.getLayoutMetrics",
  "Page.createIsolatedWorld",
  "Page.captureScreenshot",
  "Runtime.callFunctionOn",
  "Runtime.releaseObject",
]);
