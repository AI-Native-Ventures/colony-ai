// HTML report for the fresh-HOME packaged-app proof. Same page structure and styling as the
// earlier gate reports (candidate-105b/build-report.mjs): verdict card, summary table, method,
// evidence tables with PASS / FAIL / NOT OBSERVED classes, verbatim texts, accounts to clean up.
// Pure: takes a model, returns a string. Escapes everything it prints.

export const esc = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");

/** CSS class for a status: pass, fail, no (not observed, blocked, incomplete) or info. */
export function statusClass(status) {
  const value = String(status ?? "");
  if (value.startsWith("PASS")) return "pass";
  if (value.startsWith("FAIL")) return "fail";
  if (/NOT OBSERVED|BLOCKED|INCOMPLETE|UNPROVEN/u.test(value)) return "no";
  return "info";
}

const shotImg = (rel) =>
  rel
    ? `<a href="${esc(rel)}"><img loading="lazy" src="${esc(rel)}" alt="screenshot"></a>`
    : "";

const rowHtml = (row) =>
  `<tr><td><code>${esc(row.id)}</code></td><td>${esc(row.label)}</td><td class="${statusClass(row.status)}">${esc(row.status)}</td><td class="num">${row.tMs == null ? "" : `${(row.tMs / 1000).toFixed(1)} s`}</td><td>${esc(row.detail)}${shotImg(row.screenshot)}</td></tr>`;

const list = (items) =>
  items?.length
    ? `<ol>${items.map((item) => `<li><code>${esc(item)}</code></li>`).join("")}</ol>`
    : "<p>(none seen)</p>";

const CSS = `:root{--bg:#f6f7f9;--fg:#1d2733;--card:#fff;--line:#d5dce4;--pass:#1b7a4b;--fail:#b3261e;--no:#8a5a00;--info:#44566b}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--fg:#e6ebf1;--card:#1b222b;--line:#324050;--pass:#5fd39a;--fail:#ff8a80;--no:#f2c35b;--info:#9fb1c5}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px}
main{max-width:1280px;margin:0 auto}h1{font-size:26px}h2{font-size:20px;margin-top:0}h3{font-size:16px}
section,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid var(--line);padding:7px 9px;vertical-align:top;text-align:left}
.pass{color:var(--pass);font-weight:600}.fail{color:var(--fail);font-weight:600}.no{color:var(--no);font-weight:600}.info{color:var(--info)}
.badge{font-size:13px;border:1px solid currentColor;border-radius:999px;padding:1px 10px;margin-left:8px}.num{white-space:nowrap}
img{display:block;max-width:min(100%,520px);margin-top:8px;border:1px solid var(--line);border-radius:6px}
pre{white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:6px;font-size:13px}code{font-size:12px;word-break:break-all}
.verdict{font-size:20px;font-weight:700}.note{border-left:3px solid var(--no);padding-left:10px}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}`;

/**
 * Build the report page.
 * @param {object} model
 * @param {string} model.title page title
 * @param {{status: string, headline: string}} model.verdict overall status and one paragraph
 * @param {string} [model.version] version the app reports about itself
 * @param {string} [model.app] bundle path or label
 * @param {string} [model.relay]
 * @param {string} [model.window] run window text
 * @param {object[]} model.rows {id, label, status, detail, tMs?, screenshot?}
 * @param {{groups: object, findings: object[], status: string}} model.scan from scanCapture()
 * @param {Record<string, string[]>} [model.surfaces] distinct visible texts per recorder key
 * @param {object[]} [model.prompts] prompt log entries
 * @param {string[]} [model.method]
 * @param {string[]} [model.knownRemainder] things that are expected to still say the old name, with why
 * @param {{email: string, role: string}[]} [model.accounts]
 * @param {object} [model.home] fresh HOME evidence {path, before, after, tree}
 */
export function buildBrandReport(model) {
  const scan = model.scan;
  const verdict = model.verdict;
  const groupRows = Object.entries(scan.groups)
    .map(
      ([name, group]) =>
        `<tr><td><code>${esc(name)}</code></td><td class="${statusClass(group.status)}">${esc(group.status)}</td><td class="num">${group.observed}</td><td class="num">${group.findings.filter((f) => f.severity === "fail").length}</td></tr>`,
    )
    .join("");
  const findingRows = scan.findings
    .map(
      (f) =>
        `<tr><td><code>${esc(f.surface)}</code></td><td class="${f.severity === "fail" ? "fail" : "info"}">${esc(f.kind)}${f.severity === "info" ? " (info)" : ""}</td><td><code>${esc(f.match)}</code></td><td>${esc(f.context)}</td></tr>`,
    )
    .join("");
  const surfaces = Object.entries(model.surfaces ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, texts]) =>
        `<details><summary><code>${esc(name)}</code> (${texts.length} distinct texts)</summary>${list(texts)}</details>`,
    )
    .join("");
  const prompts = (model.prompts ?? [])
    .map(
      (p) =>
        `<tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${p.firstRowMs == null ? "no activity" : `${(p.firstRowMs / 1000).toFixed(1)} s`}</td><td>${esc(p.endedBecause)} (${p.elapsedMs == null ? "?" : `${(p.elapsedMs / 1000).toFixed(0)} s`})</td><td><code>${esc(JSON.stringify(p.rowTextsSeen ?? []))}</code></td></tr>`,
    )
    .join("");
  const accounts = (model.accounts ?? [])
    .map(
      (a) =>
        `<tr><td><code>${esc(a.email)}</code></td><td>${esc(a.role)}</td></tr>`,
    )
    .join("");
  const home = model.home
    ? `<section><h2>Throwaway HOME</h2><p>Path: <code>${esc(model.home.path)}</code>. Top-level entries before launch: <code>${esc((model.home.before ?? []).join(", ") || "none")}</code>. After the run: <code>${esc((model.home.after ?? []).join(", ") || "none")}</code>.</p>${model.home.tree?.length ? `<details><summary>Entries inside the Colony folder (names only)</summary>${list(model.home.tree)}</details>` : ""}</section>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(model.title)}</title>
<style>
${CSS}
</style></head><body><main>
<h1>${esc(model.title)}</h1>
<div class="card"><p class="verdict ${statusClass(verdict.status)}">${esc(verdict.status)}</p>
<p><b>Version the app itself reports: ${esc(model.version ?? "not observed")}</b>. Bundle ${esc(model.app ?? "unknown")}. Relay ${esc(model.relay ?? "unknown")}. Run window ${esc(model.window ?? "unknown")}.</p>
<p>${esc(verdict.headline)}</p></div>
<div class="card"><h2>Surfaces judged</h2><table><thead><tr><th>Surface</th><th>Status</th><th>Texts seen</th><th>Failing findings</th></tr></thead><tbody>${groupRows}</tbody></table>
<p>The old name fails on every surface, in any case. Pipes, flags, UUIDs and redirects fail on the plain surfaces only; the Show details popover and an expanded transcript are opt-in raw text and are checked for the old name alone. A surface with no text recorded is NOT OBSERVED, never PASS.</p></div>
<div class="card"><h2>Method, constraints and deviations</h2><ul>${(model.method ?? []).map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>
${model.knownRemainder?.length ? `<div class="card"><h2>Known remainder (expected, not a regression)</h2><ul>${model.knownRemainder.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
<section><h2>Checks</h2><table><thead><tr><th>Step</th><th>What</th><th>Status</th><th>Time</th><th>Exact evidence</th></tr></thead><tbody>${(model.rows ?? []).map(rowHtml).join("")}</tbody></table></section>
<section><h2>Findings (${scan.findings.length})</h2>${findingRows ? `<table><thead><tr><th>Surface</th><th>Kind</th><th>Match</th><th>Context</th></tr></thead><tbody>${findingRows}</tbody></table>` : "<p>No findings on any surface.</p>"}</section>
<section><h2>Prompts sent to Scout</h2>${prompts ? `<table><thead><tr><th>#</th><th>What</th><th>First activity</th><th>Ended</th><th>Activity row texts seen</th></tr></thead><tbody>${prompts}</tbody></table>` : "<p>No prompt was sent.</p>"}</section>
<section><h2>Every distinct visible text, verbatim</h2>${surfaces || "<p>Nothing was recorded.</p>"}</section>
${home}
<section><h2>Smoke accounts to clean up</h2>${accounts ? `<table><thead><tr><th>Email</th><th>Role</th></tr></thead><tbody>${accounts}</tbody></table>` : "<p>None created.</p>"}<p>Nothing was deleted.</p></section>
</main></body></html>`;
  return html.replaceAll("—", " - ");
}
