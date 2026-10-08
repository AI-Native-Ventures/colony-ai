// Render observed candidate evidence, keeping interrupted attempts separate from the final gate.
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
const out = process.env.AI_OUT;
if (!out || !process.env.AI_STATE)
  throw new Error("Explicit evidence and private state paths required");
const state = JSON.parse(await readFile(process.env.AI_STATE, "utf8"));
const docs = [];
for (const name of await readdir(out))
  if (/^phase-.*\.json$/.test(name))
    docs.push({
      name,
      ...JSON.parse(await readFile(path.join(out, name), "utf8")),
    });
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\u2014", ",");
const accounts = Object.entries(state)
  .filter(([, v]) => v?.email)
  .map(([label, v]) => ({
    label,
    email: v.email,
    business: v.business ?? "No business recorded",
    createdAt: v.createdAt ?? "Creation timestamp not directly observed",
  }));
const verdict = "CANDIDATE DEFECT";
const row = (phase, id) =>
  docs.find((d) => d.phase === phase)?.rows.find((r) => r.id === id);
const evidenceRows = (rows) =>
  `<table><thead><tr><th>Row</th><th>Observed state</th><th>Evidence</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.id ?? r.name)}<br>${esc(r.label)}</td><td class="${r.status === "PASS" ? "pass" : r.status === "FAIL" ? "fail" : "unknown"}">${esc(r.status)}</td><td>${esc(r.detail)}${r.screenshot ? `<p><a href="${esc(r.screenshot)}"><img loading="lazy" src="${esc(r.screenshot)}" alt="${esc(r.id)} observed state"></a></p>` : ""}</td></tr>`).join("")}</tbody></table>`;
const finalPhases = [
  "G1-CLEAN",
  "G1-SCOUT-RESUME",
  "G3-POLL-AND-UI",
  "G4-FLAG-ON",
  "G6-NAMING",
  "G1-NATIVE-MIGRATION",
];
const finalDocs = finalPhases
  .map((phase) => docs.find((d) => d.phase === phase))
  .filter(Boolean);
const archiveDocs = docs.filter((d) => !finalPhases.includes(d.phase));
const groups = finalDocs
  .map(
    (d) =>
      `<section><h2>${esc(d.phase)}</h2>${evidenceRows(d.rows)}<details><summary>Collected observations and diagnostics</summary><pre>${esc(JSON.stringify(d.notes, null, 2))}</pre></details></section>`,
  )
  .join("");
const archived = archiveDocs
  .map(
    (d) =>
      `<details><summary>${esc(d.phase)}: earlier attempt or retained baseline</summary>${evidenceRows(d.rows)}<pre>${esc(JSON.stringify(d.notes, null, 2))}</pre></details>`,
  )
  .join("");
const host = JSON.parse(
  await readFile(path.join(out, "browser-tab-results.json"), "utf8"),
);
const missing = [
  {
    id: "G1-invite-create-counter",
    status: "NOT OBSERVED",
    detail:
      "Actual invite rejoin showed no Business form. Zero production community-create requests were not separately counted, so the full original invite regression row is not claimed.",
  },
  {
    id: "G1-removed-member",
    status: "NOT OBSERVED",
    detail:
      "The connection escape was induced with a closed loopback relay in the throwaway device configuration. A real production membership revocation was not performed.",
  },
  {
    id: "G1-avatar-retry",
    status: "NOT OBSERVED",
    detail:
      "Avatar upload and a real failed upload with Retry were not part of this resumed time box.",
  },
  {
    id: "G1-dock-terminal-files",
    status: "NOT OBSERVED",
    detail:
      "The standalone dock Terminal and Files regression rows were not observed in this candidate run. Canvas edit and save are proven by WK3.",
  },
  {
    id: "G2-download",
    status: "BLOCKED",
    detail:
      "Electron app.getPath(home) returns /Users/mac under the guard. No download was started, and no Electron path was used to write to the owner home.",
  },
  {
    id: "G2-VoiceOver",
    status: "NOT OBSERVED",
    detail: "VoiceOver was not tested, as specified.",
  },
  {
    id: "G3-admin-unpin",
    status: "NOT OBSERVED",
    detail: "Listed worker gap. Only author unpin was tested.",
  },
  {
    id: "G4-real-model",
    status: "NOT OBSERVED",
    detail:
      "Real Chromium navigation by a real model is outside scope. FAKE provider only.",
  },
  {
    id: "G5-Codex-roundtrip",
    status: "NOT OBSERVED",
    detail: "A live Codex round trip is outside scope.",
  },
  {
    id: "G1-full-app-default-migration",
    status: "NOT OBSERVED",
    detail:
      "Every full app launch kept COLONY_NEST_MIGRATION=0. Optional bundled-native-host default migration is separate evidence and does not prove full app UI or restored agents.",
  },
];
const native = docs.find((d) => d.phase === "G1-NATIVE-MIGRATION");
const nativeSummary = native
  ? `${native.rows.filter((r) => r.status === "PASS").length} PASS, ${native.rows.filter((r) => r.status === "FAIL").length} FAIL, ${native.rows.filter((r) => r.status === "NOT OBSERVED").length} NOT OBSERVED in bundled-native-host sanity. <a href="migration/index.html">Migration manifests and checks</a>.`
  : "Bundled native migration evidence not yet recorded.";
const summary = [
  [
    "G1 clean first run",
    "PASS",
    "Uninterrupted third business, explicitly authorized at 08:14. FAKE live before launch and kept alive. Intro 290 ms, reply 55,697 ms. Version 1.0.6 and Google control retained from prior observed rows.",
  ],
  [
    "G1 recovered Scout",
    "DEFECT, pre-existing",
    "No business intro within 30 s on the recovered setup. Direct reply 70,426 ms. welcomeKickoff.ts is byte-identical to published origin/main. Actual timeline and coordinator marker diagnosis are distinguished below.",
  ],
  [
    "G2 visible browser",
    "PASS with download gap",
    "Host isolation, cookies, schemes, metadata refusal, forget and sign out retained. Actual UI loads loopback, restores across reload and forgets storage on device removal and invite rejoin. Downloads remain blocked.",
  ],
  [
    "G3 Work and Knowledge",
    "PASS for observed rows",
    "WK3 saved text appeared after polling in 1,728 ms. WK4 and WK9 pass. WK13 re-read after Pinned loaded its actual empty state. Prior pin and author-unpin rows retained.",
  ],
  [
    "G4 agent browser",
    "FAIL",
    "Default off: genuine FAKE request had no browser tools, broker disabled and controls absent. Flag on: open thread loses threadRootId in WorkAreaLayout, so Allow agent remains disabled. Remaining control rows not observed; no production loopback seam was bypassed.",
  ],
  [
    "G5 ChatGPT off",
    "PASS",
    "Flag unset on Connect, all nine Settings groups with their displayed tabs, and all four loaded Power sections. No ChatGPT surface.",
  ],
  [
    "G6 naming",
    "PASS for visited views",
    "292 recorded snapshots, 124 view labels, zero unexplained old-name hits. Buzz menu/title are expected PR packaging. Model-only buzz-dev-mcp IDs, <buzz-event> and BUZZ_ names are listed internal exceptions.",
  ],
  [
    "Migration sanity",
    native?.rows.some((r) => r.status === "FAIL")
      ? "FAIL"
      : native
        ? "Native evidence only"
        : "NOT OBSERVED",
    nativeSummary,
  ],
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Colony 1.0.6 candidate gate</title><style>body{font:15px/1.5 system-ui;margin:0;background:#f4f3f7;color:#272330}main{max-width:1200px;margin:auto;padding:32px}h1{font-size:30px}h2{font-size:23px}section{background:white;padding:24px;margin:24px 0;border-radius:12px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #dedce3;padding:12px;text-align:left;vertical-align:top}td:first-child{width:24%}td:nth-child(2){width:16%;font-weight:700}img{max-width:650px;width:100%;border:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:450px;overflow:auto}.pass{color:#18653e}.fail{color:#aa253e}.unknown{color:#745725}details{margin:18px 0}a{color:#4542a6}</style><main>
<h1>${verdict}</h1><p><b>With COLONY_BROWSER_AGENT=1 and an actual question thread open, Allow an agent remains disabled.</b> <code>desktop/src/features/workarea/dock/WorkAreaLayout.tsx:221-231</code> rebuilds channel context without <code>threadRootId</code>, although <code>ChannelScreen.tsx:854</code> supplies it. <code>BrowserAgentControls.tsx:39-44</code> then derives a null task ID. The candidate source at 253f1f2a1 has the same omission. No product fix was made.</p>
<p>The recovered Scout intro is also recorded as a defect. Coordinator confirms its interrupted-setup behavior is pre-existing: <code>desktop/src/features/onboarding/welcomeKickoff.ts:742-753,780-786</code> is byte-identical between candidate and published origin/main. The clean uninterrupted first run passed both Scout timing gates.</p>
<p>Packaged CI candidate, not a release. PR 267 supplied head 253f1f2a1. Runtime reports version 1.0.6. App: <code>/Users/mac/Downloads/Colony-candidate-106/app-extracted/darwin-arm64/Buzz.app</code>. Production relay: <code>https://relay.colony.ainative.ventures</code>. Expected PR packaging: Buzz menu and window title.</p>
<section><h2>Final observed gate</h2><table><tr><th>Gate</th><th>Status</th><th>Result and limits</th></tr>${summary.map(([g, s, d]) => `<tr><td>${esc(g)}</td><td>${esc(s)}</td><td>${g === "Migration sanity" ? d : esc(d)}</td></tr>`).join("")}</table></section>
<section><h2>Safety and evidence corrections</h2><p>Every resumed full app launch used the existing guard with a synthetic denied-read probe before exec, throwaway HOME, COLONY_NEST_MIGRATION=0 and keychain-deny sandbox. Runtime process.env.HOME and userData matched the disposable paths. The probe returned Operation not permitted. Electron app.getPath(home) nevertheless remained /Users/mac, so downloads were never started. Owner .buzz, .colony and keychain contents were never read or changed. No real browser login or provider credentials were used.</p><p>The old safety hold is historical. The resumed guard supplied the effective sandbox probe that the prior Electron evaluation could not run. WK3's immediate stale cached view was resolved by polling the real canvas for up to 15 s. WK13's initial absence read during Loading was discarded; the final PASS requires the loaded Pinned empty state. Power was likewise re-read after its sections loaded. G1 recovered intro text was corrected from the inaccurate only-connect-later wording to the actually retained tool-free response. Progress remains append-only and records these corrections.</p><p>Device removal was exercised only after saving a usable invite, with the throwaway device relay changed temporarily to ws://127.0.0.1:1. This proves the actual removal UI under a synthetic connection failure, not a production outage or membership revocation. The same old browser business ID was probed empty after removal, then the actual invite rejoin and visible browser were empty. Rejoin generated a new local device community ID, so that second empty profile alone is not the basis of the forget PASS.</p><p>Agent-browser rows were imported from prepared worker commit f2e7e8e0c, branch feat/agent-browser-downloads. The packaged production broker has no approved loopback grant seam. No arbitrary task grant, private-address bypass or real model was used. Upload is additionally outside the candidate's closed PR 266 slice.</p></section>
<section><h2>Disposable smoke accounts and businesses</h2><table><tr><th>Profile label</th><th>Account</th><th>Business</th><th>Creation time</th></tr>${accounts.map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.email)}</td><td>${esc(a.business)}</td><td>${esc(a.createdAt)}</td></tr>`).join("")}</table><p>Three businesses total. The first two used the original allowance. The third clean first run was explicitly authorized by the coordinator at 08:14 after the production window cleared. First reached Connect about 06:33 SAST; second created 06:44:52 SAST; third created about 08:19 SAST. Invite rejoin used the same business and no Business form. No further business creation occurred.</p></section>
${groups}
<section><h2>Retained browser host evidence</h2><p>These original host rows are retained, without rerunning them. The two old isolation-probe failures are superseded only where stated above. The Electron OS home-path finding and download block remain current.</p>${evidenceRows(host.rows)}</section>
<section><h2>Remaining limits</h2>${evidenceRows(missing)}</section>
<section><h2>Earlier attempts and retained baseline</h2><p>Earlier network, setup and harness timing failures are shown for provenance. They do not override the later final observed rows. Full G1 is not claimed PASS.</p>${archived}</section>
<p>Generated ${esc(new Date().toISOString())}. Harness changes are separate from the packaged product. A source test or prepared row is not packaged proof. Screenshots and JSON evidence are local artifacts beside this HTML. No product change, release or deployment is claimed.</p></main></html>`;
await writeFile(path.join(out, "index.html"), html);
await writeFile(
  path.join(out, "accounts-businesses.json"),
  JSON.stringify(accounts, null, 2),
);
console.log(`${verdict}: ${path.join(out, "index.html")}`);
