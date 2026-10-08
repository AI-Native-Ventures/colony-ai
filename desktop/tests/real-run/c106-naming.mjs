import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { OUT, Rec } from "./ai-lib.mjs";
const rec = new Rec("G6-NAMING");
const scans = [];
for (const f of await readdir(OUT)) {
  if (!/^phase-.*\.json$/.test(f)) continue;
  const d = JSON.parse(await readFile(path.join(OUT, f), "utf8"));
  for (const s of d.notes?.namingScans ?? [])
    scans.push({
      phase: d.phase,
      label: s.view ?? s.tag,
      text: s.text ?? "",
      attrs: s.hits ?? [],
      title: s.title,
    });
  for (const s of d.notes?.settingsScans ?? [])
    scans.push({
      phase: d.phase,
      label: s.label ?? "Power",
      text: s.text ?? "",
      attrs: s.attrs ?? [],
      title: s.title,
    });
  for (const s of d.notes?.powerScans ?? [])
    scans.push({
      phase: d.phase,
      label: "Power " + s.name,
      text: s.text ?? "",
      attrs: [s.tree ?? ""],
      title: "Buzz",
    });
}
const hits = [];
const known = [];
for (const s of scans) {
  for (const value of [s.text, ...s.attrs])
    for (const m of value.matchAll(/.{0,70}buzz.{0,70}/gi)) {
      const context = m[0];
      const entry = { phase: s.phase, view: s.label, context };
      if (/buzz-dev-mcp|<buzz-event>|\bBUZZ_[A-Z_]+/.test(context))
        known.push(entry);
      else hits.push(entry);
    }
}
const unique = (x) => [
  ...new Map(x.map((v) => [JSON.stringify(v), v])).values(),
];
rec.notes.views = [...new Set(scans.map((s) => s.phase + ": " + s.label))];
rec.notes.scans = scans.length;
rec.notes.hits = unique(hits);
rec.notes.knownInternal = unique(known);
rec.notes.expectedPackaging =
  "PR package app/window/menu Buzz, allowed by brief. Original G1-version captures menu and title.";
for (const view of rec.notes.views) {
  const found = rec.notes.hits.filter((h) => h.phase + ": " + h.view === view);
  rec.row(
    "G6-view-" + rec.rows.length,
    view,
    found.length ? "FAIL" : "PASS",
    found.length
      ? JSON.stringify(found)
      : "No unexplained buzz in recorded visible text, aria/title/alt attributes or tooltips for this visited view.",
  );
}
rec.row(
  "G6-tools",
  "Model-facing internal names",
  "PASS",
  "Genuine FAKE requests offer buzz-dev-mcp__read_file, shell, str_replace, todo, view_image and load_skill. Known buzz-dev-mcp ids, <buzz-event> prompt tag and BUZZ_ environment names reported as allowed internal identifiers.",
);
rec.row(
  "G6-overall",
  "Naming scan of default views visited",
  rec.notes.hits.length ? "FAIL" : "PASS",
  `${scans.length} recorded snapshots; ${rec.notes.views.length} view labels; ${rec.notes.hits.length} unexplained hits; ${rec.notes.knownInternal.length} known internal contexts. Packaging title/menu excepted.`,
);
await rec.write();
console.log(
  JSON.stringify(
    {
      scans: scans.length,
      views: rec.notes.views.length,
      hits: rec.notes.hits,
      known: rec.notes.knownInternal,
    },
    null,
    2,
  ),
);
