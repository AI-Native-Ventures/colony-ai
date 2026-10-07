// HTML report for the Work, Knowledge, notes and pins packaged-app gate. Same styling helpers as
// the brand proof report (esc, statusClass). Pure: takes a model, returns a string.

import { esc, statusClass } from "./brand-report.mjs";

const shotImg = (rel) =>
  rel
    ? `<a href="${esc(rel)}"><img loading="lazy" src="${esc(rel)}" alt="screenshot"></a>`
    : "";

const rowHtml = (row) =>
  `<tr><td><code>${esc(row.id)}</code></td><td>${esc(row.label)}</td><td class="${statusClass(row.status)}">${esc(row.status)}</td><td class="num">${row.tMs == null ? "" : `${(row.tMs / 1000).toFixed(1)} s`}</td><td>${esc(row.detail)}${shotImg(row.screenshot)}</td></tr>`;

const CSS = `:root{--bg:#f6f7f9;--fg:#1d2733;--card:#fff;--line:#d5dce4;--pass:#1b7a4b;--fail:#b3261e;--no:#8a5a00;--info:#44566b}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--fg:#e6ebf1;--card:#1b222b;--line:#324050;--pass:#5fd39a;--fail:#ff8a80;--no:#f2c35b;--info:#9fb1c5}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px}
main{max-width:1180px;margin:0 auto}h1{font-size:26px}h2{font-size:20px;margin-top:0}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid var(--line);padding:7px 9px;vertical-align:top;text-align:left}
.pass{color:var(--pass);font-weight:600}.fail{color:var(--fail);font-weight:600}.no{color:var(--no);font-weight:600}.info{color:var(--info)}
.num{white-space:nowrap}img{display:block;max-width:min(100%,520px);margin-top:8px;border:1px solid var(--line);border-radius:6px}
code{font-size:12px;word-break:break-all}.verdict{font-size:20px;font-weight:700}.note{border-left:3px solid var(--no);padding-left:10px}`;

/**
 * @param {object} model
 * @param {string} model.title
 * @param {{status: string, headline: string}} model.verdict
 * @param {string} [model.version] version the app reports about itself
 * @param {string} [model.app]
 * @param {string} [model.relay]
 * @param {string} [model.tag] run tag used in the note and message text
 * @param {object[]} model.rows {id, label, status, detail, tMs?, screenshot?}
 * @param {string[]} [model.notes] plain sentences about how the run was made
 * @param {{email: string, role: string}[]} [model.accounts] smoke accounts left for cleanup
 */
export function buildWorkKnowledgeReport(model) {
  const notes = (model.notes ?? [])
    .map((note) => `<p class="note">${esc(note)}</p>`)
    .join("");
  const accounts = (model.accounts ?? [])
    .map(
      (account) =>
        `<li><code>${esc(account.email)}</code> ${esc(account.role)}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(model.title)}</title><style>${CSS}</style></head><body><main>
<h1>${esc(model.title)}</h1>
<section><p class="verdict ${statusClass(model.verdict.status)}">${esc(model.verdict.status)}</p><p>${esc(model.verdict.headline)}</p>
<p>App version ${esc(model.version ?? "unknown")}. App ${esc(model.app ?? "")}. Relay ${esc(model.relay ?? "")}. Run tag <code>${esc(model.tag ?? "")}</code>.</p>${notes}</section>
<section><h2>Rows</h2><table><thead><tr><th>Id</th><th>Row</th><th>Status</th><th>At</th><th>What was observed</th></tr></thead><tbody>${(model.rows ?? []).map(rowHtml).join("")}</tbody></table></section>
<section><h2>Smoke accounts to clean up</h2>${accounts ? `<ul>${accounts}</ul>` : "<p>(none)</p>"}<p>Never deleted by the harness.</p></section>
</main></body></html>`;
}
