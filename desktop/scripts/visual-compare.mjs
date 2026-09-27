import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
let manifestArg;
let outputPathArg;
let skipBuild = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--output") {
    outputPathArg = args[index + 1];
    index += 1;
  } else if (args[index] === "--skip-build") {
    skipBuild = true;
  } else if (args[index].startsWith("--")) {
    throw new Error(`Unsupported option: ${args[index]}`);
  } else if (!manifestArg) {
    manifestArg = args[index];
  } else {
    throw new Error(`Unexpected argument: ${args[index]}`);
  }
}
const manifestPath = path.resolve(
  desktopRoot,
  manifestArg ?? "tests/visual/starter-manifest.json",
);
const outputDir = path.resolve(
  desktopRoot,
  outputPathArg ??
    `tests/visual/artifacts/${new Date().toISOString().replaceAll(":", "-")}`,
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = expandManifest(manifest);
const referenceBaseUrl = entries[0]
  ? new URL(entries[0].referenceUrl).origin
  : "";

if (args.includes("--output") && !outputPathArg) {
  throw new Error("--output requires a directory path.");
}
if (entries.length === 0) {
  throw new Error("The visual comparison manifest has no cases.");
}
assertManifest(entries);

await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify({ ...manifest, captureTime: manifest.captureTime ?? new Date().toISOString() }, null, 2)}\n`,
);
await assertReferenceServer(entries);

const childEnv = {
  ...process.env,
  CARGO_BUILD_JOBS: "4",
  VISUAL_COMPARE_MANIFEST: manifestPath,
  VISUAL_COMPARE_OUTPUT_DIR: outputDir,
  VISUAL_COMPARE_REFERENCE_BASE_URL: referenceBaseUrl,
};
let previewProcess;

try {
  if (skipBuild) {
    try {
      await access(path.join(desktopRoot, "dist", "index.html"));
    } catch {
      throw new Error(
        "--skip-build needs an existing desktop/dist/index.html.",
      );
    }
  } else {
    await run("pnpm", ["build:e2e"], { cwd: desktopRoot, env: childEnv });
  }

  const port = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${port}/`;
  childEnv.VISUAL_COMPARE_APP_BASE_URL = appBaseUrl;
  previewProcess = spawn(
    "pnpm",
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: desktopRoot,
      env: childEnv,
      stdio: "ignore",
      detached: process.platform !== "win32",
    },
  );
  await waitForServer(previewProcess, appBaseUrl);
  await run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "tests/visual/playwright.config.ts",
    ],
    { cwd: desktopRoot, env: childEnv },
  );
  await writeGallery(entries, outputDir, manifest);
  process.stdout.write(
    `Visual comparison gallery: ${path.join(outputDir, "index.html")}\n`,
  );
} finally {
  if (previewProcess) {
    await stopProcessTree(previewProcess);
  }
}

function expandManifest(source) {
  const defaults = source.defaults ?? {};
  const cases = source.cases ?? source.entries ?? [];
  return cases.map((entry) => ({
    ...defaults,
    ...entry,
    referencePrefs: mergeStorageSeed(
      defaults.referencePrefs,
      entry.referencePrefs,
    ),
    appPrefs: mergeStorageSeed(defaults.appPrefs, entry.appPrefs),
    actions: entry.actions ?? defaults.actions ?? [],
  }));
}

function mergeStorageSeed(base = {}, override = {}) {
  return {
    ...base,
    ...override,
    localStorage: { ...base.localStorage, ...override.localStorage },
    sessionStorage: { ...base.sessionStorage, ...override.sessionStorage },
    cookies: { ...base.cookies, ...override.cookies },
  };
}

function assertManifest(cases) {
  const ids = new Set();
  for (const entry of cases) {
    if (!entry.id || !/^[a-zA-Z0-9._-]+$/.test(entry.id)) {
      throw new Error(`Invalid case id: ${String(entry.id)}`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate case id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!entry.referenceUrl || !entry.appRoute) {
      throw new Error(`${entry.id} needs referenceUrl and appRoute.`);
    }
    const referenceUrl = new URL(entry.referenceUrl);
    if (referenceUrl.port === "5193") {
      throw new Error(`${entry.id} points at forbidden port 5193.`);
    }
    if (referenceUrl.origin !== referenceBaseUrl) {
      throw new Error(
        `${entry.id} must use the manifest reference origin ${referenceBaseUrl}.`,
      );
    }
    if (!["1728x1117", "1440x900"].includes(entry.viewport)) {
      throw new Error(
        `${entry.id} has an unsupported viewport: ${String(entry.viewport)}`,
      );
    }
    if (!["light", "dark"].includes(entry.theme)) {
      throw new Error(
        `${entry.id} has an unsupported theme: ${String(entry.theme)}`,
      );
    }
    if (!Array.isArray(entry.actions)) {
      throw new Error(`${entry.id} actions must be an array.`);
    }
  }
}

async function assertReferenceServer(cases) {
  const response = await fetch(referenceBaseUrl, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new Error(
      `Frozen reference server returned HTTP ${response.status}.`,
    );
  }
  for (const entry of cases) {
    const responseForRoute = await fetch(entry.referenceUrl, {
      signal: AbortSignal.timeout(3000),
    });
    if (!responseForRoute.ok) {
      throw new Error(
        `${entry.id} reference URL returned HTTP ${responseForRoute.status}.`,
      );
    }
  }
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a local preview port.");
  }
  const { port } = address;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function run(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${signal ?? code}.`));
      }
    });
  });
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite preview exited with ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = new Error(`Preview returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Vite preview did not become ready: ${lastError?.message ?? "timeout"}`,
  );
}

async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

async function writeGallery(cases, root, sourceManifest) {
  const cards = [];
  for (const entry of cases) {
    const folder = entry.id;
    const metricPath = path.join(root, folder, "metrics.json");
    const metrics = JSON.parse(await readFile(metricPath, "utf8"));
    const ratio = (metrics.changedPixelRatio * 100).toFixed(2);
    const regions =
      metrics.largestDiffRegions
        .slice(0, 3)
        .map(
          (region) =>
            `${region.pixels} px at ${region.x},${region.y} (${region.width}x${region.height})`,
        )
        .join("; ") || "No changed pixels";
    cards.push(`<article class="case">
      <header><div><h2>${escapeHtml(entry.id)}</h2><p>${entry.viewport} · ${escapeHtml(entry.theme)} · ${escapeHtml(entry.appRoute)}</p></div><strong>${ratio}% changed</strong></header>
      <div class="images">
        <a href="${folder}/side-by-side.png"><img src="${folder}/side-by-side.png" alt="${escapeHtml(entry.id)} side by side"><span>Side by side</span></a>
        <a href="${folder}/overlay.png"><img src="${folder}/overlay.png" alt="${escapeHtml(entry.id)} overlay"><span>50 percent overlay</span></a>
        <a href="${folder}/diff-heatmap.png"><img src="${folder}/diff-heatmap.png" alt="${escapeHtml(entry.id)} pixel difference heatmap"><span>Diff heatmap</span></a>
      </div>
      <details><summary>Capture files and largest regions</summary><p>${escapeHtml(regions)}</p><nav><a href="${folder}/reference.png">Reference</a><a href="${folder}/app.png">App</a><a href="${folder}/metrics.json">Metrics JSON</a></nav></details>
    </article>`);
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Visual comparison gallery</title>
<style>
  :root{color-scheme:dark;font:15px/1.5 Inter,system-ui,sans-serif;background:#111318;color:#f3f4f6}body{margin:0;padding:28px}h1{margin:0 0 6px;font-size:25px}body>p{margin:0 0 24px;color:#a7abb5}.grid{display:grid;gap:18px}.case{border:1px solid #343842;border-radius:12px;background:#1b1e25;padding:18px}.case header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.case h2{margin:0;font-size:18px}.case p{margin:4px 0 12px;color:#a7abb5}.case header strong{white-space:nowrap;color:#c5adff}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.images a{color:#dedfe5;text-decoration:none}.images img{display:block;width:100%;max-height:310px;object-fit:contain;object-position:left top;background:#0c0d11;border:1px solid #343842}.images span{display:block;padding-top:5px;font-size:13px}details{margin-top:13px;color:#c2c5ce}details nav{display:flex;gap:14px}details a{color:#c5adff}@media(max-width:900px){body{padding:16px}.images{grid-template-columns:1fr}}
</style></head><body><h1>Visual comparison gallery</h1><p>Frozen reference captures compared with the E2E mock app. Pixel changes are counted exactly with no masks or tolerance.</p><main class="grid">${cards.join("\n")}</main>
<script type="application/json" id="capture-manifest">${escapeHtml(JSON.stringify({ ...sourceManifest, captureTime: sourceManifest.captureTime ?? null }))}</script>
</body></html>`;
  await writeFile(path.join(root, "index.html"), `${html}\n`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
