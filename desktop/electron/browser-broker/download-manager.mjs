import path from "node:path";
import * as filesystem from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  safeDownloadName,
  numberedDownloadName,
} from "../browser-host-policy.mjs";

export const MAX_AGENT_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const MAX_NAME_ATTEMPTS = 200;
const MAX_ACTIVE = 4;
const DEADLINE_MS = 30_000;
const MAX_STREAM_READS = 8192;

function checkedUrl(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 8192 ||
    [...value].some(
      (ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f,
    )
  )
    throw new Error("Invalid browser download link");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid browser download link");
  return url.href;
}

/**
 * Main-owned direct-link transfers through an injected Electron session fetch.
 * Authority is checked before every manual redirect, bodies are capped before
 * staging, and atomic hard links publish complete files without overwriting.
 * Cross-volume publication fails closed. No paths or response data leave main.
 */
export function createBrowserDownloadManager({
  staging,
  downloadsPath,
  fetchForTab,
  remember = () => {},
  onRecovery = () => {},
  fs = filesystem,
  now = Date.now,
  maxBytes = MAX_AGENT_DOWNLOAD_BYTES,
  maxActive = MAX_ACTIVE,
  deadlineMs = DEADLINE_MS,
} = {}) {
  if (
    !staging?.stageBytes ||
    typeof fetchForTab !== "function" ||
    typeof downloadsPath !== "string" ||
    !path.isAbsolute(downloadsPath) ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_AGENT_DOWNLOAD_BYTES ||
    !Number.isInteger(maxActive) ||
    maxActive < 1 ||
    maxActive > MAX_ACTIVE ||
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > DEADLINE_MS
  )
    throw new Error("Invalid browser download configuration");
  const active = new Map();
  let stopped = false;

  async function publish(file, check) {
    // Prepare normal owner write permissions on the private inode before
    // atomic publication. Upload copies use separate owned staging entries.
    await fs.chmod(file.path, 0o600);
    await fs.mkdir(downloadsPath, { recursive: true });
    const name = safeDownloadName(file.name);
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      check();
      const fileName = numberedDownloadName(name, attempt);
      const destination = path.join(downloadsPath, fileName);
      try {
        // The source is complete and privately staged. link is atomic and
        // refuses existing destinations, including symlinks and empty files.
        await fs.link(file.path, destination);
        return { fileName, destination };
      } catch (error) {
        if (error?.code !== "EEXIST")
          throw new Error("Browser download could not be saved");
      }
    }
    throw new Error("Browser download filename limit reached");
  }

  async function download(
    tabId,
    initialUrl,
    { grantId, signal, check, authorize } = {},
  ) {
    if (
      typeof grantId !== "string" ||
      !grantId ||
      grantId.length > 256 ||
      typeof check !== "function" ||
      typeof authorize !== "function"
    )
      throw new Error("Invalid browser download authority");
    if (stopped) throw new Error("Browser downloads are stopped");
    check();
    if (signal?.aborted) throw new Error("Browser download cancelled");
    if (active.size >= maxActive)
      throw new Error("Browser download capacity reached");
    let url = checkedUrl(initialUrl);
    const id = randomUUID();
    const deadline = now() + deadlineMs;
    const controller = new AbortController();
    const entry = { tabId, grantId, controller, aborted: false };
    active.set(id, entry);
    let timer;
    let rejectAborted;
    const interrupted = new Promise((_, reject) => {
      rejectAborted = reject;
    });
    const abort = () => {
      entry.aborted = true;
      controller.abort();
      rejectAborted(new Error("Browser download cancelled or timed out"));
      onRecovery();
    };
    entry.abort = abort;
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, deadlineMs);
    const guarded = () => {
      if (controller.signal.aborted || now() >= deadline)
        throw new Error("Browser download cancelled or timed out");
      check();
    };
    let cleanupTarget;
    let staged;
    const job = (async () => {
      let result;
      let failure;
      try {
        let response;
        for (let redirects = 0; ; redirects += 1) {
          guarded();
          await authorize(url);
          guarded();
          response = await fetchForTab(tabId, url, {
            method: "GET",
            credentials: "include",
            redirect: "manual",
            signal: controller.signal,
          });
          guarded();
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          if (redirects >= MAX_REDIRECTS)
            throw new Error("Browser download redirect limit reached");
          const location = response.headers.get("location");
          if (
            typeof location !== "string" ||
            !location ||
            location.length > 8192
          )
            throw new Error("Invalid browser download redirect");
          cleanupTarget = response.body;
          await cleanupTarget?.cancel();
          cleanupTarget = undefined;
          url = checkedUrl(new URL(location, url).href);
        }
        if (!response.ok || !response.body)
          throw new Error("Browser download unavailable");
        const reader = response.body.getReader();
        cleanupTarget = reader;
        const announced = response.headers.get("content-length");
        if (
          announced &&
          /^\d{1,20}$/u.test(announced) &&
          Number(announced) > maxBytes
        )
          throw new Error("Browser download byte limit reached");
        const chunks = [];
        let size = 0;
        let reads = 0;
        for (;;) {
          if (++reads > MAX_STREAM_READS)
            throw new Error("Browser download stream limit reached");
          guarded();
          const { done, value } = await reader.read();
          guarded();
          if (done) break;
          if (
            !(value instanceof Uint8Array) ||
            size + value.byteLength > maxBytes
          )
            throw new Error("Browser download byte limit reached");
          size += value.byteLength;
          chunks.push(Buffer.from(value));
        }
        const disposition = response.headers.get("content-disposition") ?? "";
        const headerName =
          disposition.length <= 1024
            ? /filename="([^"]{1,255})"/iu.exec(disposition)?.[1]
            : undefined;
        const name = safeDownloadName(
          headerName ?? new URL(url).pathname.split("/").at(-1),
        );
        guarded();
        staged = await staging.stageBytes(
          grantId,
          name,
          Buffer.concat(chunks, size),
          {
            signal: controller.signal,
            check: guarded,
          },
        );
        guarded();
        const { fileName, destination } = await publish(staged, guarded);
        // A published file is complete and belongs to the person even if
        // revocation races its completion. It is never deleted on grant expiry.
        remember(tabId, id, destination, fileName, size);
        let cleanupRequired = false;
        try {
          await staging.cleanup(staged.id);
        } catch {
          cleanupRequired = true;
          onRecovery();
        }
        staged = undefined;
        result = {
          downloadId: id,
          name: fileName,
          bytes: size,
          cleanupRequired,
        };
      } catch (error) {
        if (staged) {
          try {
            await staging.cleanup(staged.id);
          } catch {
            onRecovery();
          }
        }
        failure = error;
      }
      controller.abort();
      if (cleanupTarget) {
        try {
          await cleanupTarget.cancel();
        } catch {
          entry.aborted = true;
          entry.cancelFailed = true;
          entry.cleanupTarget = cleanupTarget;
          onRecovery();
          failure ??= new Error(
            "Browser download cancellation requires recovery",
          );
        }
      }
      if (failure) throw failure;
      return result;
    })();
    // An uncooperative fetch/reader keeps its bounded slot until it actually
    // retires. Timing out a caller must not permit unlimited abandoned jobs.
    const retiring = job.finally(() => {
      entry.settled = true;
      if (!entry.cancelFailed) active.delete(id);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
    entry.retiring = retiring;
    retiring.catch(() => {});
    return Promise.race([retiring, interrupted]);
  }

  async function recover({ timeoutMs = 5000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
      throw new Error("Invalid browser download recovery deadline");
    const deadline = now() + timeoutMs;
    let recoveryTimer;
    const timeout = new Promise((_, reject) => {
      recoveryTimer = setTimeout(
        () => reject(new Error("Browser downloads are still stopping")),
        timeoutMs,
      );
    });
    const work = (async () => {
      for (const [id, entry] of active) {
        if (now() >= deadline || (entry.aborted && !entry.settled))
          throw new Error("Browser downloads are still stopping");
        if (!entry.cancelFailed) continue;
        // Retain one retry promise per owned reader. Caller deadlines do not
        // clear the slot or start additional concurrent cleanup attempts.
        entry.recovery ??= Promise.resolve()
          .then(() => entry.cleanupTarget.cancel())
          .then(() => active.delete(id))
          .finally(() => {
            entry.recovery = undefined;
          });
        await entry.recovery;
      }
    })();
    try {
      await Promise.race([work, timeout]);
    } finally {
      clearTimeout(recoveryTimer);
    }
  }

  return {
    download,
    active: () =>
      [...active.values()].map(({ tabId, grantId, aborted }) => ({
        tabId,
        grantId,
        aborted,
      })),
    cancelTab: (tabId) => {
      for (const entry of active.values()) {
        if (entry.tabId === tabId) entry.abort();
      }
    },
    cancelAll: () => {
      for (const entry of active.values()) entry.abort();
    },
    recover,
    /** Stop new transfers and bound waiting without releasing live slots. */
    async stop({ timeoutMs = 5000 } = {}) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
        throw new Error("Invalid browser download stop deadline");
      stopped = true;
      for (const entry of active.values()) entry.abort();
      let stopTimer;
      const timeout = new Promise((_, reject) => {
        stopTimer = setTimeout(
          () => reject(new Error("Browser downloads are still stopping")),
          timeoutMs,
        );
      });
      try {
        await Promise.race([
          (async () => {
            await Promise.allSettled(
              [...active.values()].map((entry) => entry.retiring),
            );
            await recover({ timeoutMs });
          })(),
          timeout,
        ]);
      } finally {
        clearTimeout(stopTimer);
      }
    },
  };
}
