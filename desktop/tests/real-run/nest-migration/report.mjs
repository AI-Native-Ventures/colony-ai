// HTML report in the same format as the earlier real-app gate reports (candidate-105b/index.html): a verdict
// card, a summary table, a method card, then one section per case with a step table of PASS, FAIL or
// NOT OBSERVED and the exact evidence. Self-contained: inline CSS, no external requests.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FAIL, NOT_OBSERVED, PASS, verdictOf } from "./checks.mjs";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

const statusClass = (status) =>
  status === PASS ? "pass" : status === FAIL ? "fail" : "no";

const STYLE = `:root{--bg:#f6f7f9;--fg:#1d2733;--card:#fff;--line:#d5dce4;--pass:#1b7a4b;--fail:#b3261e;--no:#8a5a00;--info:#44566b}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--fg:#e6ebf1;--card:#1b222b;--line:#324050;--pass:#5fd39a;--fail:#ff8a80;--no:#f2c35b;--info:#9fb1c5}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px}
main{max-width:1280px;margin:0 auto}h1{font-size:26px}h2{font-size:20px;margin-top:0}h3{font-size:16px}
section,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid var(--line);padding:7px 9px;vertical-align:top;text-align:left}
.pass{color:var(--pass);font-weight:600}.fail{color:var(--fail);font-weight:600}.no{color:var(--no);font-weight:600}.info{color:var(--info)}
.badge{font-size:13px;border:1px solid currentColor;border-radius:999px;padding:1px 10px;margin-left:8px}.num{white-space:nowrap}
pre{white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:6px;font-size:13px}code{font-size:12px;word-break:break-all}
.verdict{font-size:20px;font-weight:700}.note{border-left:3px solid var(--no);padding-left:10px}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}`;

const rowHtml = (r) =>
  `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.label)}</td><td class="${statusClass(r.status)}">${esc(r.status)}</td><td>${esc(r.detail)}</td></tr>`;

const caseSection = (c) => {
  const verdict = verdictOf(c.rows);
  const counts = {
    [PASS]: c.rows.filter((r) => r.status === PASS).length,
    [FAIL]: c.rows.filter((r) => r.status === FAIL).length,
    [NOT_OBSERVED]: c.rows.filter((r) => r.status === NOT_OBSERVED).length,
  };
  return `<section id="case-${esc(c.id)}"><h2>${esc(c.id)}: ${esc(c.title)} <span class="badge ${statusClass(verdict)}">${esc(verdict)}</span></h2>
<p>${esc(c.description)} Fixture variant <code>${esc(c.variant)}</code>. ${counts[PASS]} PASS, ${counts[FAIL]} FAIL, ${counts[NOT_OBSERVED]} NOT OBSERVED.</p>
${c.blocked ? `<p class="note"><b>Blocked:</b> ${esc(c.blocked)}</p>` : ""}
<table><thead><tr><th>Step</th><th>What</th><th>Status</th><th>Exact evidence</th></tr></thead><tbody>${c.rows.map(rowHtml).join("")}</tbody></table>
${c.timeline?.length ? `<details><summary>Timeline (${c.timeline.length} events)</summary><pre>${esc(c.timeline.join("\n"))}</pre></details>` : ""}
${c.evidence ? `<details><summary>Raw evidence (diff buckets, host log lines, records)</summary><pre>${esc(JSON.stringify(c.evidence, null, 1))}</pre></details>` : ""}
</section>`;
};

/** Render the whole report. */
export function renderReport(data) {
  const verdicts = data.cases.map((c) => ({
    ...c,
    verdict: verdictOf(c.rows),
  }));
  const overall = verdictOf(data.cases.flatMap((c) => c.rows));
  const failing = verdicts.filter((c) => c.verdict === FAIL).map((c) => c.id);
  const gaps = verdicts
    .filter((c) => c.verdict === NOT_OBSERVED)
    .map((c) => c.id);
  const headline =
    overall === PASS
      ? "Every check in every case was observed and passed."
      : overall === FAIL
        ? `Failing cases: ${failing.join(", ")}. The migration is not proven safe.`
        : `No failure, but ${gaps.length} case(s) have checks that were NOT OBSERVED (${gaps.join(", ")}). Read them as gaps in proof, not as passes.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.title)}</title>
<style>${STYLE}</style></head><body><main>
<h1>${esc(data.title)}</h1>
<div class="card"><p class="verdict ${statusClass(overall)}">${esc(overall)}: ${esc(headline)}</p>
<p>App under test: <code>${esc(data.app?.path)}</code>, version the app reports: <b>${esc(data.app?.version ?? "not read")}</b>. Run window ${esc(data.startedAt)} to ${esc(data.finishedAt)}. Every case ran with HOME pointing at a throwaway fixture folder; the real home folder and the real ~/.buzz were never opened.</p></div>
<div class="card"><h2>Summary</h2><table><thead><tr><th>Case</th><th>What</th><th>Status</th><th>Why</th></tr></thead><tbody>
${verdicts
  .map((c) => {
    const bad = c.rows.filter((r) => r.status !== PASS);
    return `<tr><td><a href="#case-${esc(c.id)}">${esc(c.id)}</a></td><td>${esc(c.title)}</td><td class="${statusClass(c.verdict)}">${esc(c.verdict)}</td><td>${
      bad.length
        ? esc(
            bad
              .slice(0, 4)
              .map((r) => `${r.id} ${r.status}`)
              .join(", "),
          )
        : "all checks PASS"
    }</td></tr>`;
  })
  .join("")}
</tbody></table></div>
<div class="card"><h2>Method, constraints and deviations</h2><ul>${(data.method ?? []).map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>
<div class="card"><h2>Interface assumed with the migration (contract.mjs)</h2><pre>${esc(JSON.stringify(data.contract, null, 1))}</pre></div>
${verdicts.map(caseSection).join("\n")}
</main></body></html>`;
  return html.replaceAll("\u2014", " - ");
}

/** Write index.html and results.json into `dir`. */
export async function writeReport(dir, data) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), renderReport(data));
  await writeFile(
    path.join(dir, "results.json"),
    `${JSON.stringify({ ...data, overall: verdictOf(data.cases.flatMap((c) => c.rows)) }, null, 2)}\n`,
  );
  return path.join(dir, "index.html");
}
