import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_EVENTS = 600;
const MAX_LINE = 240;
const POLL_MS = 250;

/** Redact anything that could be a credential before a log line is kept. */
export function redactLogLine(line) {
  return (
    String(line)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI escapes from log lines
      .replace(/\u001b\[[0-9;]*m/gu, "")
      .replace(/\b(nsec|nostr:nsec)1[0-9a-z]+/giu, "<secret>")
      .replace(
        /\b(npub|note|nevent)1[0-9a-z]{20,}/giu,
        (m) => `${m.slice(0, 9)}...`,
      )
      .replace(/\bBearer\s+\S+/giu, "Bearer <secret>")
      .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/gu, "<jwt>")
      .replace(/\bsk-[\w-]{8,}/gu, "<secret>")
      .replace(
        /(\w*(?:key|token|secret|password|cookie|private|credential)\w*)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/giu,
        "$1$2<secret>",
      )
      .replace(/\b[0-9a-f]{32,}\b/giu, (m) => `${m.slice(0, 8)}...`)
      .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/gu, "<long-value>")
      .slice(0, MAX_LINE)
  );
}

async function listFiles(directory, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full, depth + 1)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function shortName(root, file) {
  return path
    .relative(root, file)
    .replace(/[0-9a-f]{16,}/giu, (m) => `${m.slice(0, 8)}...`);
}

/**
 * Poll the managed-agent files under the throwaway profile and, optionally, the native
 * host stderr file. Every file's first sighting, growth and every appended log line is
 * stamped with the wall clock at observation (resolution about 250 ms). Lines are
 * redacted and bounded, nothing else from the profile is read.
 */
export function startAgentTrace({ userDataDir, extraFiles = [] }) {
  const events = [];
  const lines = [];
  const offsets = new Map();
  const sizes = new Map();
  let running = true;
  const note = (event) => {
    if (events.length < MAX_EVENTS) events.push(event);
  };
  const tick = async () => {
    const agentsDir = path.join(userDataDir, "agents");
    const files = [...(await listFiles(agentsDir)), ...extraFiles];
    for (const file of files) {
      let info;
      try {
        info = await stat(file);
      } catch {
        continue;
      }
      const root = extraFiles.includes(file) ? path.dirname(file) : userDataDir;
      const name = shortName(root, file);
      const previous = sizes.get(file);
      if (previous === undefined) {
        note({
          at: Date.now(),
          event: "file created",
          file: name,
          size: info.size,
        });
      } else if (info.size !== previous) {
        note({
          at: Date.now(),
          event: "file changed",
          file: name,
          size: info.size,
        });
      }
      sizes.set(file, info.size);
      const isLog = file.endsWith(".log");
      if (!isLog || info.size === (offsets.get(file) ?? 0)) continue;
      try {
        const handle = await open(file, "r");
        try {
          const start = offsets.get(file) ?? 0;
          const length = Math.min(info.size - start, 262144);
          if (length > 0) {
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, start);
            offsets.set(file, start + length);
            const at = Date.now();
            for (const raw of buffer.toString("utf8").split(/\r?\n/u)) {
              if (raw.trim() && lines.length < MAX_EVENTS * 4)
                lines.push({ at, file: name, text: redactLogLine(raw) });
            }
          }
        } finally {
          await handle.close();
        }
      } catch {
        // The file may be rotated or locked for a moment.
      }
    }
  };
  const loop = (async () => {
    while (running) {
      try {
        await tick();
      } catch {
        // Tracing must never break the run.
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    await tick().catch(() => {});
  })();
  return {
    events,
    lines,
    async stop() {
      running = false;
      await loop;
    },
  };
}
