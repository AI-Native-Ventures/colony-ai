import { consequentialCategory, isCredentialField } from "./classifier.mjs";
import {
  REDACTED,
  redactText,
  redactUrl,
  sanitizeUntrusted,
} from "./redaction.mjs";

/**
 * Accessibility tree snapshot builder. Pure: it takes the node array that the
 * main process driver got from CDP `Accessibility.getFullAXTree` (plus a small
 * `extras` map of DOM attributes) and returns bounded text with stable element
 * references. It never evaluates anything and never sees cookies or storage.
 *
 * Reference stability
 *   A ref maps to a CDP backendDOMNodeId and persists across snapshots of the
 *   same document, so an element keeps its ref while the page re-renders around
 *   it. A new document calls `registry.reset()`, which clears the map and
 *   advances the generation. The ref counter is NEVER reset, so a ref from an
 *   older generation can not be re-issued to a different element: acting on it
 *   resolves to nothing and the caller returns `stale_ref`.
 *
 * Values of input like controls are printed only when `extras` proves the
 * field is not a credential. Missing extras fail closed to `[redacted]`.
 */

export const SNAPSHOT_LIMITS = Object.freeze({
  maxNodes: 1_500,
  maxChars: 30_000,
  maxDepth: 40,
  maxText: 160,
  maxRefs: 5_000,
});

const INTERACTIVE = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "treeitem",
  "listbox",
]);

const INPUT_LIKE = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
  "slider",
  "listbox",
]);

const STRUCTURE = new Set([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "form",
  "region",
  "dialog",
  "alertdialog",
  "alert",
  "status",
  "heading",
  "list",
  "listitem",
  "table",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "grid",
  "gridcell",
  "img",
  "figure",
  "article",
  "tabpanel",
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "tree",
  "group",
]);

const WITH_REF = new Set([
  ...INTERACTIVE,
  "form",
  "dialog",
  "alertdialog",
  "main",
  "navigation",
  "region",
  "search",
  "table",
  "heading",
  "img",
  "article",
]);

// Roles whose name is the text of their content: do not repeat that text.
const NAMED_FROM_CONTENT = new Set([
  "link",
  "button",
  "heading",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "img",
]);

// Roles that print no name of their own (their text arrives as children).
const NO_PRINTED_NAME = new Set([
  "list",
  "listitem",
  "row",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "alert",
  "status",
  "tablist",
]);

const PASS_THROUGH = new Set([
  "none",
  "presentation",
  "generic",
  "paragraph",
  "rootwebarea",
  "webarea",
  "inlinetextbox",
  "linebreak",
  "listmarker",
  "labeltext",
  "section",
  "div",
]);

const ALIASES = new Map([
  ["popupbutton", "combobox"],
  ["disclosuretriangle", "button"],
  ["image", "img"],
  ["textfield", "textbox"],
  ["editabletext", "textbox"],
]);

export function createRefRegistry({ maxRefs = SNAPSHOT_LIMITS.maxRefs } = {}) {
  let generation = 1;
  let counter = 0;
  const byBackend = new Map();
  const byRef = new Map();
  return {
    get generation() {
      return generation;
    },
    get size() {
      return byRef.size;
    },
    /** New document: forget every ref. Counter is kept so refs never repeat. */
    reset() {
      generation += 1;
      byBackend.clear();
      byRef.clear();
      return generation;
    },
    refFor(backendNodeId, meta = {}) {
      if (!Number.isInteger(backendNodeId)) return null;
      const known = byBackend.get(backendNodeId);
      if (known) {
        byRef.set(known, { ...byRef.get(known), ...meta, backendNodeId });
        return known;
      }
      if (byRef.size >= maxRefs) return null;
      counter += 1;
      const ref = `e${counter}`;
      byBackend.set(backendNodeId, ref);
      byRef.set(ref, { ...meta, backendNodeId, generation });
      return ref;
    },
    /** Entry for a ref of the CURRENT generation, else null (stale). */
    resolve(ref) {
      return typeof ref === "string" ? (byRef.get(ref) ?? null) : null;
    },
    /** Drop one ref, e.g. after the driver found its node gone. */
    forget(ref) {
      const entry = byRef.get(ref);
      if (!entry) return false;
      byRef.delete(ref);
      byBackend.delete(entry.backendNodeId);
      return true;
    },
  };
}

function roleOf(node) {
  const raw = String(node?.role?.value ?? "").toLowerCase();
  return ALIASES.get(raw) ?? raw;
}

function propertyOf(node, name) {
  const found = (node.properties ?? []).find((entry) => entry?.name === name);
  return found?.value?.value;
}

const quote = (text) =>
  `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

function cleanText(value, max) {
  return redactText(sanitizeUntrusted(String(value ?? ""), max), max);
}

function attributesOf(node, role) {
  const attributes = [];
  const checked = propertyOf(node, "checked");
  if (checked === true || checked === "true") attributes.push("checked");
  else if (checked === "mixed") attributes.push("checked=mixed");
  if (propertyOf(node, "pressed") === true) attributes.push("pressed");
  if (propertyOf(node, "selected") === true) attributes.push("selected");
  const expanded = propertyOf(node, "expanded");
  if (expanded === true) attributes.push("expanded");
  else if (expanded === false && INTERACTIVE.has(role))
    attributes.push("collapsed");
  if (propertyOf(node, "disabled") === true) attributes.push("disabled");
  if (propertyOf(node, "required") === true) attributes.push("required");
  if (propertyOf(node, "readonly") === true) attributes.push("readonly");
  const invalid = propertyOf(node, "invalid");
  if (invalid && invalid !== "false") attributes.push("invalid");
  if (propertyOf(node, "modal") === true) attributes.push("modal");
  const level = propertyOf(node, "level");
  if (Number.isInteger(level)) attributes.push(`level=${level}`);
  return attributes;
}

/**
 * Build the snapshot text.
 *
 * @param nodes     CDP AXNode[]
 * @param registry  ref registry for this tab's current document
 * @param extras    Map or object: backendDOMNodeId -> { type, autocomplete,
 *                  href, buttonType, origin }
 */
export function buildSnapshot({
  nodes,
  registry,
  extras = {},
  url = "",
  title = "",
  text = "inline",
  maxNodes = SNAPSHOT_LIMITS.maxNodes,
  maxChars = SNAPSHOT_LIMITS.maxChars,
  maxDepth = SNAPSHOT_LIMITS.maxDepth,
} = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = new Map();
  for (const node of list)
    if (node && node.nodeId !== undefined) byId.set(String(node.nodeId), node);
  const extraFor = (id) =>
    id === undefined
      ? undefined
      : extras instanceof Map
        ? extras.get(id)
        : extras[id];

  const header = `page url=${redactUrl(url) || "about:blank"} title=${quote(cleanText(title, 120))} generation=${registry.generation}`;
  const lines = [header];
  let chars = header.length;
  let emitted = 0;
  let visited = 0;
  let truncated = false;
  const seen = new Set();

  const roots = list.filter(
    (node) =>
      node && (node.parentId === undefined || !byId.has(String(node.parentId))),
  );
  // Depth first, explicit stack: hostile pages can nest tens of thousands deep.
  const stack = [];
  for (let index = roots.length - 1; index >= 0; index -= 1)
    stack.push({ node: roots[index], depth: 0, suppressText: false });

  while (stack.length > 0) {
    const { node, depth, suppressText } = stack.pop();
    const key = String(node.nodeId);
    if (seen.has(key)) continue;
    seen.add(key);
    visited += 1;

    const role = roleOf(node);
    const hidden = propertyOf(node, "hidden") === true;
    if (hidden) continue;
    const children = (node.childIds ?? [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
    const pushChildren = (nextDepth, nextSuppress) => {
      for (let index = children.length - 1; index >= 0; index -= 1)
        stack.push({
          node: children[index],
          depth: nextDepth,
          suppressText: nextSuppress,
        });
    };

    const backendId = node.backendDOMNodeId;
    const extra = extraFor(backendId);
    let line = null;
    let emits = false;

    if (node.ignored === true || PASS_THROUGH.has(role)) {
      pushChildren(depth, suppressText);
      continue;
    }

    if (role === "statictext") {
      if (text === "inline" && !suppressText) {
        const value = cleanText(node.name?.value, SNAPSHOT_LIMITS.maxText);
        if (value.length > 0) {
          line = `${"  ".repeat(Math.min(depth, maxDepth))}- text ${quote(value)}`;
          emits = true;
        }
      }
    } else if (role === "iframe") {
      const origin =
        typeof extra?.origin === "string"
          ? redactUrl(extra.origin).replace(/\/$/u, "")
          : "";
      line = `${"  ".repeat(Math.min(depth, maxDepth))}- iframe${origin ? ` origin=${origin}` : ""} (not accessible)`;
      emits = true;
      // Frame content is deliberately not walked: it can belong to an origin
      // the person never approved.
    } else if (INTERACTIVE.has(role) || STRUCTURE.has(role)) {
      const name = NO_PRINTED_NAME.has(role)
        ? ""
        : cleanText(node.name?.value, SNAPSHOT_LIMITS.maxText);
      const parts = [`- ${role}`];
      if (name.length > 0) parts.push(quote(name));
      if (WITH_REF.has(role) && backendId !== undefined) {
        const ref = registry.refFor(backendId, {
          role,
          name,
          inputType: extra?.type,
        });
        if (ref) parts.push(`[ref=${ref}]`);
      }
      const attributes = attributesOf(node, role);
      if (attributes.length > 0) parts.push(`[${attributes.join(",")}]`);

      const credential =
        (INPUT_LIKE.has(role) || role === "checkbox") &&
        isCredentialField({
          role,
          inputType: extra?.type,
          autocomplete: extra?.autocomplete,
          name,
        });
      if (INPUT_LIKE.has(role)) {
        const raw = node.value?.value;
        if (raw !== undefined && raw !== null && String(raw).length > 0) {
          const safeToShow = extra !== undefined && !credential;
          parts.push(
            `value=${safeToShow ? quote(cleanText(raw, SNAPSHOT_LIMITS.maxText)) : REDACTED}`,
          );
        }
      }
      if (role === "link" && typeof extra?.href === "string") {
        const href = redactUrl(extra.href);
        if (href)
          parts.push(
            `href=${href.length > 200 ? `${href.slice(0, 200)}...` : href}`,
          );
      }
      if (credential) parts.push("credential");
      const asksConfirmation =
        (role === "button" || role === "link" || role === "menuitem") &&
        consequentialCategory(name) !== null;
      if (asksConfirmation) parts.push("consequential");
      line = `${"  ".repeat(Math.min(depth, maxDepth))}${parts.join(" ")}`;
      emits = true;
      // Chromium can repeat an input value in nested StaticText nodes.
      // Neither credential nor unknown-input descendants may expose that value.
      if (!credential && !(INPUT_LIKE.has(role) && extra === undefined))
        pushChildren(depth + 1, suppressText || NAMED_FROM_CONTENT.has(role));
    } else {
      // Unknown role: keep walking so nothing below it is lost.
      pushChildren(depth, suppressText);
    }

    if (!emits || line === null) continue;
    if (depth > maxDepth) {
      truncated = true;
      continue;
    }
    if (emitted >= maxNodes || chars + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
    emitted += 1;
  }

  const omitted = Math.max(0, list.length - visited);
  if (truncated)
    lines.push(
      `truncated emitted=${emitted} omitted=${omitted} (scroll or narrow the request)`,
    );
  return {
    text: lines.join("\n"),
    generation: registry.generation,
    stats: { nodes: list.length, visited, emitted, truncated, omitted, chars },
  };
}
