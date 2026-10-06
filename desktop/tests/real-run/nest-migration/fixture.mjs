// Fixture builder: creates a throwaway HOME shaped like the owner's real ~/.buzz. Every file is synthetic. The
// names, kinds, modes and layout come from a read-only `ls -la` of the real folder (names only, no contents were
// read), so the proof exercises the same shapes without any private data being copied.
//
// usage: node fixture.mjs --out <empty dir> --variant owner
import { createHash } from "node:crypto";
import {
  chmod,
  lutimes,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEW_NEST, NO_REFRESH_VERSION, OLD_NEST } from "./contract.mjs";
import {
  createWalDatabase,
  readDatabase,
  readMainFileOnly,
} from "./sqlite.mjs";

/** Marker written into every fixture root. Nothing in the harness acts on a folder that lacks it. */
export const FIXTURE_MARKER = ".nest-proof-fixture";

/** Every variant the builder knows. Each is a HOME shape plus what the proof should expect. */
export const VARIANTS = Object.freeze({
  owner:
    "Only ~/.buzz, shaped like the owner's real folder. The baseline migration case.",
  "owner-stale-version":
    "Like owner, but the version stamps are old so the host refreshes AGENTS.md and the skill. User notes below the managed markers must survive.",
  "repos-symlinked":
    "Like owner, but REPOS is a symlink to a folder outside HOME and .repos-dir records that folder.",
  "repos-dir-inside":
    "Like owner, but .repos-dir holds an absolute path inside the old nest, which the migration must rewrite.",
  "both-colony-has-nest":
    "Both ~/.buzz and ~/.colony exist, and ~/.colony already holds a nest with entries that conflict.",
  "both-unrelated-colony":
    "Both exist, and ~/.colony holds only an unrelated file and no nest marker.",
  "colony-only":
    "Only ~/.colony exists, with a nest. Nothing may be migrated or created in ~/.buzz.",
  empty: "A HOME with neither folder: a fresh install.",
});

/** Deterministic pseudo-random bytes: same seed and label give the same bytes. */
export function syntheticBytes(seed, label, size) {
  const chunks = [];
  let length = 0;
  for (let counter = 0; length < size; counter++) {
    const block = createHash("sha256")
      .update(`${seed}:${label}:${counter}`)
      .digest();
    chunks.push(block);
    length += block.length;
  }
  return Buffer.concat(chunks).subarray(0, size);
}

/**
 * Refuse to build into, or act on, anything that could be the real HOME or the real nest folders.
 * A root is acceptable only when it is not the real home, not an ancestor of the real home, and not inside
 * the real ~/.buzz or ~/.colony. A non-empty folder must already carry the fixture marker.
 */
export async function assertThrowawayRoot(
  root,
  { requireMarker = false } = {},
) {
  if (!path.isAbsolute(root))
    throw new Error(`fixture root must be absolute: ${root}`);
  let real;
  try {
    real = await realpath(root);
  } catch {
    real = path.resolve(root);
  }
  const realHome = await realpath(os.homedir()).catch(() => os.homedir());
  const inside = (child, parent) =>
    child === parent || child.startsWith(`${parent}${path.sep}`);
  if (inside(realHome, real))
    throw new Error(`refusing: ${real} is the real home folder or contains it`);
  for (const nest of [OLD_NEST, NEW_NEST])
    if (inside(real, path.join(realHome, nest)))
      throw new Error(`refusing: ${real} is inside the real ~/${nest}`);
  let present = true;
  try {
    await stat(real);
  } catch {
    present = false;
  }
  if (!present) {
    if (requireMarker) throw new Error(`fixture root does not exist: ${real}`);
    return real;
  }
  const entries = await readdir(real);
  const marked = entries.includes(FIXTURE_MARKER);
  if (requireMarker && !marked)
    throw new Error(`refusing: ${real} has no ${FIXTURE_MARKER} marker`);
  if (!requireMarker && entries.length > 0 && !marked)
    throw new Error(`refusing: ${real} is not empty and is not a fixture`);
  return real;
}

const PAST = new Date("2026-09-03T17:50:00Z");
const stampTime = (offsetMinutes) =>
  new Date(PAST.getTime() + offsetMinutes * 60000);

/** Small helper bound to one HOME that writes files, directories and links with fixed modes and mtimes. */
function writer(home, seed) {
  let tick = 0;
  const abs = (relative) => path.join(home, relative);
  const next = () => {
    tick += 7;
    return stampTime(tick);
  };
  const api = {
    async dir(relative, mode = 0o700) {
      await mkdir(abs(relative), { recursive: true });
      await chmod(abs(relative), mode);
    },
    async file(relative, content, mode = 0o644) {
      await mkdir(path.dirname(abs(relative)), { recursive: true });
      const data =
        typeof content === "number"
          ? syntheticBytes(seed, relative, content)
          : content;
      await writeFile(abs(relative), data);
      await chmod(abs(relative), mode);
      const when = next();
      await utimes(abs(relative), when, when);
    },
    async link(relative, target) {
      await mkdir(path.dirname(abs(relative)), { recursive: true });
      await symlink(target, abs(relative));
      const when = next();
      await lutimes(abs(relative), when, when);
    },
  };
  return api;
}

const AGENTS_MD = (stamp) => `# Colony nest

This folder is where Colony agents work. Put files you want agents to find under REPOS, PLANS and GUIDES.

<!-- BEGIN BUZZ MANAGED (regenerated by Colony, edit below the end marker) -->
Nest version stamp: ${stamp.trim()}
Agents read this file at the start of every session.
<!-- END BUZZ MANAGED -->

## My notes

- Keep release notes in OUTBOX.
- Never commit anything from .scratch.
`;

const PYVENV = (home, name) => `home = /usr/bin
include-system-site-packages = false
version = 3.12.4
executable = /usr/bin/python3.12
command = /usr/bin/python3 -m venv ${home}/${OLD_NEST}/${name}
`;

/** A venv script that names its own absolute path. It prints that path and checks the venv files exist. */
const VENV_SCRIPT = (home, name) => {
  const self = `${home}/${OLD_NEST}/${name}/bin/say`;
  return `#!/bin/sh
# self: ${self}
VENV="${home}/${OLD_NEST}/${name}"
[ -f "$VENV/pyvenv.cfg" ] && [ -f "${self}" ] && echo "venv-ok $VENV"
`;
};

async function writeForeign(w, home) {
  const nest = OLD_NEST;
  for (const name of [".venv-tts", ".venv-chatterbox"]) {
    const base = `${nest}/${name}`;
    await w.dir(base, 0o755);
    await w.file(`${base}/pyvenv.cfg`, PYVENV(home, name), 0o644);
    await w.dir(`${base}/bin`, 0o755);
    await w.file(`${base}/bin/say`, VENV_SCRIPT(home, name), 0o755);
    await w.file(
      `${base}/bin/activate`,
      `VIRTUAL_ENV="${home}/${nest}/${name}"\nexport VIRTUAL_ENV\n`,
      0o644,
    );
    await w.link(`${base}/bin/python`, "/usr/bin/python3");
    await w.dir(`${base}/lib/python3.12/site-packages/synthetic`, 0o755);
    await w.file(
      `${base}/lib/python3.12/site-packages/synthetic/__init__.py`,
      `PATH = "${home}/${nest}/${name}/lib"\n`,
      0o644,
    );
    await w.file(
      `${base}/lib/python3.12/site-packages/synthetic/weights.bin`,
      48 * 1024,
      0o644,
    );
    await w.dir(`${base}/include`, 0o755);
    await w.dir(`${base}/share`, 0o755);
  }
  // Loose notes written into the working folder by agents. Ambiguous output: left in place.
  await w.file(`${nest}/dock-check.md`, "dock check: ok\n", 0o644);
  await w.file(`${nest}/gate-check.md`, "gate check\n", 0o644);
  await w.file(`${nest}/gate-note.md`, "gate note\n", 0o644);
  await w.file(`${nest}/probe-note.md`, "probe note\n", 0o644);
  // A foreign skill inside a harness folder Colony shares with other tools, and an absolute link to it from
  // another harness folder (the owner's real folder has exactly this).
  const skill = `${nest}/.agents/skills/colony-product-videos`;
  await w.dir(skill, 0o755);
  await w.file(`${skill}/SKILL.md`, "# Product videos\n", 0o644);
  await w.file(`${skill}/render.sh`, "#!/bin/sh\necho render\n", 0o755);
  await w.link(
    `${nest}/.claude/skills/colony-product-videos`,
    `${home}/${skill}`,
  );
}

async function writeOwned(w, home, { stamp, repos }) {
  const nest = OLD_NEST;
  await w.dir(nest, 0o700);
  await w.file(`${nest}/AGENTS.md`, AGENTS_MD(stamp), 0o600);
  await w.file(`${nest}/.nest-agents-version`, stamp, 0o644);
  for (const dir of ["GUIDES", "PLANS", "WORK_LOGS"])
    await w.dir(`${nest}/${dir}`, 0o700);
  await w.dir(`${nest}/OUTBOX`, 0o700);
  await w.file(
    `${nest}/OUTBOX/DAY1_VIDEO_PACK.md`,
    "# Day one video pack\n\nSynthetic outbox note.\n",
    0o644,
  );
  await w.dir(`${nest}/RESEARCH`, 0o700);
  await w.file(
    `${nest}/RESEARCH/TELEMETRY_TEARDOWN.md`,
    "# Teardown\n\nSynthetic research note.\n",
    0o644,
  );
  await w.dir(`${nest}/.scratch`, 0o700);
  for (let index = 0; index < 8; index++)
    await w.file(`${nest}/.scratch/note-${index}.txt`, 600 + index * 97, 0o644);
  await w.file(`${nest}/.scratch/leads.json`, '{"leads":[]}\n', 0o644);
  await w.dir(`${nest}/.scratch/grokbot`, 0o755);
  await w.file(`${nest}/.scratch/grokbot/frame-1.png`, 4096, 0o644);

  // Generated skill, with the version stamp inside and links in the harness folders.
  await w.dir(`${nest}/.agents`, 0o700);
  await w.dir(`${nest}/.agents/skills`, 0o700);
  await w.dir(`${nest}/.agents/skills/buzz-cli`, 0o700);
  await w.file(
    `${nest}/.agents/skills/buzz-cli/SKILL.md`,
    "# Colony CLI skill (synthetic)\n",
    0o600,
  );
  await w.file(`${nest}/.agents/skills/buzz-cli/.skill-version`, stamp, 0o644);
  for (const harness of [".claude", ".codex", ".goose"]) {
    await w.dir(`${nest}/${harness}`, 0o700);
    await w.dir(`${nest}/${harness}/skills`, 0o700);
    await w.link(
      `${nest}/${harness}/skills/buzz-cli`,
      "../../.agents/skills/buzz-cli",
    );
  }

  // models/: the speech model folder is "ready" by the host's rule (manifest version plus expected files).
  await w.dir(`${nest}/models`, 0o755);
  const stt = `${nest}/models/parakeet-tdt-ctc-110m-en`;
  await w.dir(stt, 0o755);
  await w.file(`${stt}/.buzz-model-manifest`, "2", 0o644);
  await w.file(`${stt}/model.int8.onnx`, 320 * 1024, 0o644);
  await w.file(`${stt}/tokens.txt`, 8 * 1024, 0o644);
  await w.file(`${stt}/MODEL_LICENSE.txt`, "Synthetic licence text.\n", 0o644);
  const tts = `${nest}/models/pocket-tts`;
  await w.dir(tts, 0o755);
  for (const name of [
    "bundle.json",
    "bos_before_voice.npy",
    "flow_lm_main_int8.onnx",
    "mimi_decoder_int8.onnx",
    "tokenizer.model",
    "LICENSE",
    "anna.wav",
    "vera.wav",
    "MODEL_LICENSE.txt",
  ])
    await w.file(`${tts}/${name}`, 2048 + name.length * 31, 0o644);

  // REPOS: real repositories plus the link shapes the migration has to keep meaningful.
  if (repos === "symlink") {
    await w.dir("external/repos-target", 0o755);
    await writeRepo(w, "external/repos-target/colony-social-kit");
    await w.link(`${nest}/REPOS`, `${home}/external/repos-target`);
    await w.file(
      `${nest}/.repos-dir`,
      `${home}/external/repos-target\n`,
      0o644,
    );
  } else {
    await w.dir(`${nest}/REPOS`, 0o700);
    await writeRepo(w, `${nest}/REPOS/colony-social-kit`);
    await writeRepo(w, `${nest}/REPOS/colony-social-kit-day-one-film`);
    // Relative link: stays valid wherever the folder moves.
    await w.link(`${nest}/REPOS/kit-latest`, "colony-social-kit");
    // Absolute link into the tree that is about to move: must be rewritten, or its entry left in place.
    await w.link(
      `${nest}/REPOS/kit-absolute`,
      `${home}/${nest}/REPOS/colony-social-kit`,
    );
    // Absolute link to a folder outside the nest: must be carried over unchanged.
    await w.dir("external/shared-assets", 0o755);
    await w.file("external/shared-assets/logo.svg", "<svg/>\n", 0o644);
    await w.link(
      `${nest}/REPOS/shared-assets`,
      `${home}/external/shared-assets`,
    );
    // Dangling relative link: must survive the move as a link with the same text.
    await w.link(`${nest}/REPOS/old-checkout`, "../nowhere/old-checkout");
    if (repos === "dir-inside")
      await w.file(`${nest}/.repos-dir`, `${home}/${nest}/REPOS\n`, 0o644);
  }

  // archive/archive.db with a write-ahead log: created last, as the app would leave it after a crash.
  await w.dir(`${nest}/archive`, 0o755);
}

async function writeRepo(w, base) {
  await w.dir(base, 0o755);
  await w.dir(`${base}/.git`, 0o755);
  await w.file(`${base}/.git/HEAD`, "ref: refs/heads/main\n", 0o644);
  await w.file(
    `${base}/.git/config`,
    "[core]\n\trepositoryformatversion = 0\n",
    0o644,
  );
  await w.dir(`${base}/src`, 0o755);
  await w.file(
    `${base}/src/index.js`,
    "export const hello = () => 'hi';\n",
    0o644,
  );
  await w.file(`${base}/README.md`, "# Synthetic repository\n", 0o644);
  await w.file(`${base}/assets/clip.bin`, 96 * 1024, 0o644);
  await w.file(`${base}/run.sh`, "#!/bin/sh\necho run\n", 0o755);
}

async function writeColonyNest(w, stamp, extra) {
  const nest = NEW_NEST;
  await w.dir(nest, 0o700);
  await w.file(
    `${nest}/AGENTS.md`,
    AGENTS_MD(stamp).replace("My notes", "Colony notes"),
    0o600,
  );
  await w.file(`${nest}/.nest-agents-version`, stamp, 0o644);
  await w.dir(`${nest}/GUIDES`, 0o700);
  await w.file(`${nest}/GUIDES/welcome.md`, "# Welcome (new folder)\n", 0o644);
  await w.dir(`${nest}/REPOS`, 0o700);
  if (extra) await w.file(`${nest}/${extra}`, 256, 0o644);
}

/**
 * Build a fixture.
 * @param {object} options
 * @param {string} options.root empty folder (created if missing) that will hold home/ and external/
 * @param {string} [options.variant] one of VARIANTS
 * @param {string} [options.seed] makes the synthetic bytes differ between runs
 * @param {number} [options.baseRows] rows checkpointed into archive.db
 * @param {number} [options.walRows] rows that exist only in archive.db-wal
 * @returns the fixture description, also written to <root>/fixture.json
 */
export async function buildFixture({
  root,
  variant = "owner",
  seed = "colony-nest-proof",
  baseRows = 12,
  walRows = 31,
}) {
  if (!(variant in VARIANTS)) throw new Error(`unknown variant ${variant}`);
  const realRoot = await assertThrowawayRoot(root);
  await mkdir(realRoot, { recursive: true });
  await writeFile(path.join(realRoot, FIXTURE_MARKER), `${variant}\n`);
  const resolvedRoot = await realpath(realRoot);
  const home = path.join(resolvedRoot, "home");
  await mkdir(home, { recursive: true });
  await chmod(home, 0o755);
  const w = writer(home, seed);

  const stale = variant === "owner-stale-version";
  const stamp = stale ? "1\n" : NO_REFRESH_VERSION;
  const spec = {
    variant,
    description: VARIANTS[variant],
    root: resolvedRoot,
    home,
    external: path.join(resolvedRoot, "external"),
    seed,
    versionStamp: stamp.trim(),
    nests: [],
    database: null,
    foreignScripts: [],
    userNote: "Keep release notes in OUTBOX.",
  };

  const hasOld = !["colony-only", "empty"].includes(variant);
  if (hasOld) {
    const repos =
      variant === "repos-symlinked"
        ? "symlink"
        : variant === "repos-dir-inside"
          ? "dir-inside"
          : "dir";
    await writeOwned(w, home, { stamp, repos });
    spec.nests.push(OLD_NEST);
    await writeForeign(w, home);
    for (const name of [".venv-tts", ".venv-chatterbox"])
      spec.foreignScripts.push(`${OLD_NEST}/${name}/bin/say`);

    const dbPath = path.join(home, OLD_NEST, "archive", "archive.db");
    await createWalDatabase({
      dbPath,
      readyMarker: path.join(resolvedRoot, ".wal-ready"),
      baseRows,
      walRows,
      makeRow: (index) =>
        `INSERT INTO archived_events VALUES ('npub-owner','wss://relay.example','${syntheticId(seed, index)}',9,'pub${index}',${1790000000 + index},'{"n":${index}}',${1790000000 + index});`,
    });
    await rm(path.join(resolvedRoot, ".wal-ready"), { force: true });
    const full = await readDatabase(dbPath);
    const mainOnly = await readMainFileOnly(dbPath);
    spec.database = {
      path: `${OLD_NEST}/archive/archive.db`,
      baseRows,
      walRows,
      expectedRows: baseRows + walRows,
      rows: full.rows,
      mainFileOnlyRows: mainOnly,
      idsSha256: full.idsSha256,
      walBytes: full.walBytes,
      shmPresent: full.shmPresent,
      integrity: full.integrity,
    };
    if (
      full.rows !== baseRows + walRows ||
      mainOnly !== baseRows ||
      !full.walBytes ||
      !full.shmPresent
    )
      throw new Error(
        `archive.db is not a genuine WAL case: rows ${full.rows}, main-only ${mainOnly}, wal ${full.walBytes}, shm ${full.shmPresent}`,
      );
  }
  if (variant === "both-colony-has-nest") {
    await writeColonyNest(w, stamp, null);
    spec.nests.push(NEW_NEST);
  }
  if (variant === "both-unrelated-colony") {
    await w.dir(NEW_NEST, 0o755);
    await w.file(`${NEW_NEST}/unrelated-tool.cfg`, "setting=1\n", 0o644);
    spec.nests.push(NEW_NEST);
  }
  if (variant === "colony-only") {
    await writeColonyNest(w, stamp, "OUTBOX-note.md");
    await w.dir(`${NEW_NEST}/archive`, 0o755);
    spec.nests.push(NEW_NEST);
  }
  await writeFile(
    path.join(resolvedRoot, "fixture.json"),
    `${JSON.stringify(spec, null, 2)}\n`,
  );
  return spec;
}

const syntheticId = (seed, index) =>
  createHash("sha256")
    .update(`${seed}:event:${index}`)
    .digest("hex")
    .slice(0, 32);

// Command line: node fixture.mjs --out <dir> --variant <name>
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  const out = arg("out");
  if (!out) {
    console.error(
      `usage: node fixture.mjs --out <empty dir> [--variant ${Object.keys(VARIANTS).join("|")}]`,
    );
    process.exit(2);
  }
  const spec = await buildFixture({
    root: path.resolve(out),
    variant: arg("variant", "owner"),
  });
  console.log(JSON.stringify(spec, null, 2));
}
