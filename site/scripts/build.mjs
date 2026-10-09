import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(siteRoot, "public");
const distRoot = path.join(siteRoot, "dist");
const maxFileBytes = 25 * 1024 * 1024;
const allowedHtml = new Set([
  "index.html",
  "404.html",
  "terms.html",
  "acceptable-use.html",
  "refunds.html",
  "privacy.html",
  "early-access-dialog.html",
  "hero-10/helix.html",
  "product-reference/workspace/demo-r23.html",
  "product-reference/mobile-r21/demo-r23.html",
]);
const allowedText = new Set([
  "robots.txt",
  "licenses/BUZZ-APACHE-2.0.txt",
  "licenses/MANROPE-OFL.txt",
  "product-reference/mobile-r21/assets/OFL-Manrope.txt",
  "product-reference/mobile-r21/assets/networks/LICENSE.txt",
  "product-reference/workspace/assets/networks/LICENSE.txt",
]);
const staticExtensions = new Set([
  ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".mp4", ".ico",
]);

async function listFiles(dir, prefix = "") {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the static package: ${rel}`);
    if (entry.isDirectory()) result.push(...await listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result.sort();
}

function localReference(ref) {
  const clean = ref.split(/[?#]/, 1)[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(clean)) return null;
  return clean;
}

const releaseDownloadPattern = /href="https:\/\/github\.com\/AI-Native-Ventures\/colony-ai\/releases\/download\/(desktop-v(\d+\.\d+\.\d+))\/([^"]+)"/g;

// The Download section must point at one tag-pinned desktop release that has every
// installer the page promises, so a stale or half-edited link fails the build.
function assertDownloadLinks(html) {
  const section = html.match(/<section[^>]*id="download"[\s\S]*?<\/section>/)?.[0];
  if (!section) throw new Error("index.html is missing the #download section");
  const links = [...section.matchAll(releaseDownloadPattern)];
  const tags = new Set(links.map((m) => m[1]));
  if (tags.size !== 1) throw new Error(`#download links must use exactly one desktop release tag, found: ${[...tags].join(", ") || "none"}`);
  const version = links[0][2];
  const files = links.map((m) => m[3]);
  const required = [
    [`Colony-${version}-arm64`, ".dmg"],
    [`Colony-${version}-x64`, ".exe"],
    [`Colony-${version}-x64`, ".AppImage"],
  ];
  for (const [prefix, ext] of required) {
    if (!files.some((f) => f.startsWith(prefix) && f.endsWith(ext))) {
      throw new Error(`#download is missing a ${ext} link for desktop release ${version}`);
    }
  }
  if (!files.includes("checksums.txt")) throw new Error("#download is missing the checksums.txt link");
}

async function validate(files) {
  const fileSet = new Set(files);
  for (const rel of files) {
    const absolute = path.join(publicRoot, rel);
    const info = await stat(absolute);
    if (info.size > maxFileBytes) throw new Error(`${rel} exceeds the 25 MiB per-file limit (${info.size} bytes)`);
    if (rel.endsWith(".html") && !allowedHtml.has(rel)) {
      throw new Error(`Unexpected HTML page in public package: ${rel}`);
    }
    if (rel.endsWith(".txt") && !allowedText.has(rel)) {
      throw new Error(`Unexpected text file in public package: ${rel}`);
    }
    if (rel.endsWith(".json")) {
      throw new Error(`Unexpected JSON file in public package: ${rel}`);
    }
    if (rel.endsWith(".js")) {
      const syntax = spawnSync(process.execPath, ["--check", absolute], { encoding: "utf8" });
      if (syntax.status !== 0) throw new Error(`JavaScript syntax failed for ${rel}:\n${syntax.stderr || syntax.stdout}`);
    }
    if (!rel.endsWith(".html") && !rel.endsWith(".css") && !rel.endsWith(".js")) continue;

    const content = await readFile(absolute, "utf8");
    if (rel === "index.html") assertDownloadLinks(content);
    const refs = rel.endsWith(".html")
      ? [...content.matchAll(/(?:src|href|poster)=["']([^"']+)["']/gi)].map((m) => m[1])
      : rel.endsWith(".css")
        ? [...content.matchAll(/url\(["']?([^"')]+)["']?\)/gi)].map((m) => m[1])
        : [...content.matchAll(/["'`]((?:\.\.?\/|[\w-]+\/)[\w./-]+\.(?:svg|png|jpe?g|webp|woff2|mp4))(?:[?#][^"'`]*)?["'`]/gi)].map((m) => m[1]);
    for (const raw of refs) {
      const ref = localReference(raw);
      if (!ref) continue;
      const extension = path.extname(ref).toLowerCase();
      if (!staticExtensions.has(extension)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref));
      if (target.startsWith("../") || !fileSet.has(target)) {
        throw new Error(`${rel} references missing local runtime file ${raw} (resolved to ${target})`);
      }
    }
  }
}

const files = await listFiles(publicRoot);
if (!files.includes("index.html")) throw new Error("site/public/index.html has not been provided yet");
await validate(files);

const manifest = [];
for (const rel of files) {
  const bytes = await readFile(path.join(publicRoot, rel));
  manifest.push({ path: rel, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}

if (!process.argv.includes("--check-only")) {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await Promise.all(files.map(async (rel) => {
    const target = path.join(distRoot, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(publicRoot, rel), target);
  }));
  await writeFile(path.join(distRoot, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const total = manifest.reduce((sum, file) => sum + file.bytes, 0);
console.log(`${process.argv.includes("--check-only") ? "Validated" : "Built"} ${files.length} runtime files (${(total / 1024 / 1024).toFixed(2)} MiB total; 25 MiB maximum per file).`);
