// Records a hashed manifest of <home>/.buzz and <home>/.colony (lstat fields, link targets, sha256) to a JSON file.
// usage: node gate-manifest.mjs <throwaway home> <out.json>
// Refuses the real home. Used by the final 1.0.5 gate for the seeded-HOME views (G1, G3).
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildManifest } from "./nest-migration/manifest.mjs";

const [home, out] = process.argv.slice(2);
if (!home || !out) throw new Error("usage: gate-manifest.mjs <home> <out.json>");
if (path.resolve(home) === path.resolve(os.homedir()))
  throw new Error("Refusing to read the real home");
const manifest = await buildManifest(path.resolve(home), [".buzz", ".colony"], { hash: true });
await writeFile(out, JSON.stringify(manifest, null, 1));
console.log(`${manifest.entries.length} entries written to ${out}`);
