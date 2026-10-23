#!/usr/bin/env node
// Builds the "Colony 3.0 foundation proof" page from the proof spec's captures.
//
//   node scripts/colony3-proof-report.mjs <proofDir> <outDir> [notes.json]
//
// For each capture in <proofDir>/captures.json it crops the matching design
// reference, writes reference / app / overlay / difference PNGs under
// <outDir>/img, and writes <outDir>/index.html (self-contained besides those
// images) with the metrics and the honest notes from notes.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import UPNG from "upng-js";

import { compareImages } from "./visualComparison.mjs";

const [proofDirArg, outDirArg, notesArg] = process.argv.slice(2);
if (!proofDirArg || !outDirArg) {
  console.error(
    "usage: colony3-proof-report.mjs <proofDir> <outDir> [notes.json]",
  );
  process.exit(2);
}
const proofDir = resolve(proofDirArg);
const outDir = resolve(outDirArg);
const referenceDir =
  process.env.COLONY3_REFERENCE_DIR ??
  join(homedir(), "worktrees/.lanes/colony3/reference");
const notes = notesArg
  ? JSON.parse(readFileSync(resolve(notesArg), "utf8"))
  : { captures: {}, notVerified: [], summary: [] };
const CLOSE_LEVEL = 24;

function decode(path) {
  const buffer = readFileSync(path);
  const png = UPNG.decode(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
  return {
    width: png.width,
    height: png.height,
    pixels: new Uint8Array(UPNG.toRGBA8(png)[0]),
  };
}

function encode(path, image) {
  writeFileSync(
    path,
    Buffer.from(
      UPNG.encode([image.pixels.buffer], image.width, image.height, 0),
    ),
  );
}

function crop(image, [x, y, w, h]) {
  const width = Math.max(0, Math.min(w, image.width - x));
  const height = Math.max(0, Math.min(h, image.height - y));
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    pixels.set(image.pixels.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

mkdirSync(join(outDir, "img"), { recursive: true });
const captures = JSON.parse(
  readFileSync(join(proofDir, "captures.json"), "utf8"),
);
const sections = [];

for (const capture of captures) {
  let reference = decode(join(referenceDir, `${capture.board}.png`));
  if (capture.refRect) reference = crop(reference, capture.refRect);
  const app = decode(join(proofDir, `${capture.name}.png`));
  const sizeNote =
    reference.width === app.width && reference.height === app.height
      ? null
      : `size differs: reference ${reference.width}x${reference.height}, app ${app.width}x${app.height}; compared on the shared top-left ${Math.min(reference.width, app.width)}x${Math.min(reference.height, app.height)}`;
  const width = Math.min(reference.width, app.width);
  const height = Math.min(reference.height, app.height);
  const referenceCut = crop(reference, [0, 0, width, height]);
  const appCut = crop(app, [0, 0, width, height]);
  const result = compareImages(referenceCut, appCut);

  let farPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const o = pixel * 4;
    const delta = Math.max(
      Math.abs(referenceCut.pixels[o] - appCut.pixels[o]),
      Math.abs(referenceCut.pixels[o + 1] - appCut.pixels[o + 1]),
      Math.abs(referenceCut.pixels[o + 2] - appCut.pixels[o + 2]),
    );
    if (delta > CLOSE_LEVEL) farPixels += 1;
  }
  const far = farPixels / (width * height);

  const base = capture.name;
  encode(join(outDir, "img", `${base}-ref.png`), reference);
  encode(join(outDir, "img", `${base}-app.png`), app);
  encode(join(outDir, "img", `${base}-overlay.png`), result.overlay);
  encode(join(outDir, "img", `${base}-diff.png`), result.heatmap);
  const entry = {
    ...capture,
    size: `${width}x${height}`,
    sizeNote,
    mean: result.meanAbsoluteChannelDelta,
    far,
    notes: notes.captures?.[capture.name] ?? [],
  };
  sections.push(entry);
  console.log(
    `${capture.name.padEnd(36)} ${entry.size.padEnd(10)} mean ${entry.mean.toFixed(2)}  differs>${CLOSE_LEVEL}: ${(far * 100).toFixed(2)}%${sizeNote ? "  [size differs]" : ""}`,
  );
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Colony 3.0 foundation proof</title>
<style>
  :root { --sp-measure: 78ch; }
  body { margin: 0; }
  main { max-width: 1280px; margin: 0 auto; padding: 40px 28px 72px; }
  h1 { font-size: 34px; letter-spacing: -.02em; margin: 0 0 8px; }
  h2 { font-size: 22px; margin: 40px 0 6px; letter-spacing: -.01em; }
  .lede { max-width: var(--sp-measure); color: var(--sp-muted); }
  .metrics { color: var(--sp-muted); font-size: 14px; margin: 0 0 10px; }
  .row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: start; }
  figure { margin: 0; min-width: 0; }
  figcaption { font-size: 13px; color: var(--sp-muted); margin-bottom: 6px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  figure img { display: block; width: 100%; height: auto; border: 1px solid var(--sp-border); border-radius: 6px; background: #fff; }
  .notes { max-width: var(--sp-measure); margin: 10px 0 0; padding-left: 20px; }
  .notes li { margin: 3px 0; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 13px; font-weight: 700; }
  .ok { background: #e3f2e9; color: #2b7350; }
  .warn { background: #fff0d4; color: #8a5300; }
  @media (max-width: 900px) { .row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 480px) { .row { grid-template-columns: minmax(0, 1fr); } main { padding: 24px 16px 56px; } }
</style>
</head>
<body>
<main>
  <h1>Colony 3.0 foundation proof</h1>
  <p class="lede">The Soft Field foundation, built into the desktop app on branch <code>feat/colony3-foundation</code>, set next to the owner's design. For each board: the design reference, the app captured at the same size with the Lerato Social sample data, a 50 percent overlay, and a difference map (brighter means further apart). The design is the authority: every visible difference is either fixed or listed below with its reason.</p>
${notes.summary?.length ? `<ul class="notes">${notes.summary.map((line) => `<li>${line}</li>`).join("")}</ul>` : ""}
${sections
  .map(
    (s) => `<section>
  <h2>${escapeHtml(s.title)}</h2>
  <p class="metrics">Board <strong>${escapeHtml(s.board)}</strong> · ${escapeHtml(s.size)} · mean colour difference ${s.mean.toFixed(2)} of 255 · <span class="pill ${s.far < 0.02 ? "ok" : "warn"}">${(s.far * 100).toFixed(2)}% of pixels differ visibly</span></p>
  <div class="row">
    <figure><figcaption>Design</figcaption><img src="img/${s.name}-ref.png" alt="Design reference, ${escapeHtml(s.title)}"></figure>
    <figure><figcaption>App</figcaption><img src="img/${s.name}-app.png" alt="App capture, ${escapeHtml(s.title)}"></figure>
    <figure><figcaption>Overlay</figcaption><img src="img/${s.name}-overlay.png" alt="Overlay of design and app"></figure>
    <figure><figcaption>Difference</figcaption><img src="img/${s.name}-diff.png" alt="Difference map"></figure>
  </div>
  ${s.sizeNote ? `<ul class="notes"><li>${escapeHtml(s.sizeNote)}</li></ul>` : ""}
  ${s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
</section>`,
  )
  .join("\n")}
  <h2>Not verified</h2>
  <ul class="notes">${(notes.notVerified ?? []).map((n) => `<li>${n}</li>`).join("")}</ul>
</main>
</body>
</html>
`;
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${join(outDir, "index.html")}`);
