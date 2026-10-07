import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import path from "node:path";

export const MAX_STAGED_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_STAGED_UPLOADS = 8;
const ID = /^u-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CHUNK_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 4096;
const READ_FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

function fileNameAllowed(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    ![".", ".."].includes(name) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    ![...name].some(
      (character) =>
        character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
    )
  );
}

/**
 * Main-owned immutable copies of person-selected uploads. Ownership records live
 * outside payload directories and survive every failed cleanup. The store never
 * recursively removes files; unexpected contents require explicit recovery.
 */
export function createUploadStagingStore({
  rootPath,
  maxBytes = MAX_STAGED_UPLOAD_BYTES,
  maxEntries = MAX_STAGED_UPLOADS,
  fs = filesystem,
  now = Date.now,
} = {}) {
  if (
    typeof rootPath !== "string" ||
    !path.isAbsolute(rootPath) ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_STAGED_UPLOAD_BYTES ||
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_STAGED_UPLOADS
  )
    throw new Error("Invalid upload staging configuration");
  const recordsPath = path.join(rootPath, "records");
  const payloadsPath = path.join(rootPath, "payloads");
  const entries = new Map();
  let initialized = false;
  let busy = false;

  async function exclusive(operation) {
    if (busy) throw new Error("Browser upload staging is busy");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  }

  async function ignoreMissing(operation) {
    try {
      await operation();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async function privateDirectory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid upload staging directory");
    await fs.chmod(directory, 0o700);
  }

  async function directoryEntries(directory, limit) {
    const result = [];
    const stream = await fs.opendir(directory);
    for await (const entry of stream) {
      if (result.length >= limit)
        throw new Error("Upload staging recovery is over capacity");
      result.push(entry);
    }
    return result;
  }

  function paths(id, name) {
    const directory = path.join(payloadsPath, id);
    return {
      directory,
      file: path.join(directory, name),
      record: path.join(recordsPath, `${id}.json`),
    };
  }

  async function cleanupEntry(entry) {
    entry.cleanupRequired = true;
    const owned = paths(entry.id, entry.name);
    const directory = await fs.lstat(owned.directory).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
      throw new Error("Upload staging recovery directory is invalid");
    await ignoreMissing(() => fs.unlink(owned.file));
    await ignoreMissing(() => fs.rmdir(owned.directory));
    // The durable record is last: a partial cleanup must remain retryable.
    await ignoreMissing(() => fs.unlink(owned.record));
    entries.delete(entry.id);
  }

  async function readRecord(file) {
    const handle = await fs.open(file, READ_FLAGS);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_RECORD_BYTES)
        throw new Error("Invalid upload staging recovery record");
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let used = 0;
      while (used <= MAX_RECORD_BYTES) {
        const { bytesRead } = await handle.read(
          buffer,
          used,
          buffer.length - used,
          used,
        );
        if (bytesRead === 0) break;
        used += bytesRead;
        if (used > MAX_RECORD_BYTES)
          throw new Error("Upload staging recovery record is too large");
      }
      return JSON.parse(buffer.subarray(0, used).toString("utf8"));
    } finally {
      await handle.close();
    }
  }

  async function initialize() {
    if (initialized) return;
    await privateDirectory(rootPath);
    for (const entry of await directoryEntries(rootPath, 2)) {
      if (!["records", "payloads"].includes(entry.name) || !entry.isDirectory())
        throw new Error("Unknown upload staging contents require recovery");
    }
    await privateDirectory(recordsPath);
    await privateDirectory(payloadsPath);
    entries.clear();
    for (const entry of await directoryEntries(recordsPath, maxEntries)) {
      const id = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
      if (!ID.test(id) || !entry.isFile())
        throw new Error("Invalid upload staging recovery entry");
      const record = await readRecord(path.join(recordsPath, entry.name));
      if (
        record?.version !== 1 ||
        record.id !== id ||
        !fileNameAllowed(record.name) ||
        typeof record.grantId !== "string" ||
        record.grantId.length === 0 ||
        record.grantId.length > 256 ||
        !Number.isInteger(record.size) ||
        record.size < 0 ||
        record.size > maxBytes
      )
        throw new Error("Invalid upload staging recovery record");
      entries.set(id, { ...record, cleanupRequired: true });
    }
    for (const entry of await directoryEntries(payloadsPath, maxEntries)) {
      if (!entry.isDirectory() || !entries.has(entry.name))
        throw new Error(
          "Unrecorded upload staging directory requires recovery",
        );
    }
    for (const entry of [...entries.values()]) await cleanupEntry(entry);
    initialized = true;
  }

  async function retryCleanup() {
    await initialize();
    for (const entry of [...entries.values()]) {
      if (entry.cleanupRequired) await cleanupEntry(entry);
    }
  }

  function checkCancelled(signal, check, deadline) {
    if (now() >= deadline) throw new Error("Browser upload staging timed out");
    if (signal?.aborted) throw new Error("Browser upload was cancelled");
    check?.();
  }

  async function stage(grantId, selectedPath, { signal, check } = {}) {
    return exclusive(async () => {
      const deadline = now() + 30_000;
      await retryCleanup();
      checkCancelled(signal, check, deadline);
      if (
        typeof grantId !== "string" ||
        grantId.length === 0 ||
        grantId.length > 256 ||
        typeof selectedPath !== "string" ||
        !path.isAbsolute(selectedPath) ||
        selectedPath.length > 8192 ||
        !fileNameAllowed(path.basename(selectedPath))
      )
        throw new Error("Invalid selected upload");
      if (entries.size >= maxEntries)
        throw new Error("Browser upload staging limit reached");
      const before = await fs.lstat(selectedPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size > BigInt(maxBytes)
      )
        throw new Error("Choose a regular file no larger than 32 MiB");
      const source = await fs.open(selectedPath, READ_FLAGS);
      let entry;
      let output;
      let journal;
      let failure;
      try {
        const initial = await source.stat({ bigint: true });
        if (
          !initial.isFile() ||
          initial.dev !== before.dev ||
          initial.ino !== before.ino ||
          initial.size !== before.size ||
          initial.mtimeNs !== before.mtimeNs ||
          initial.ctimeNs !== before.ctimeNs ||
          initial.size > BigInt(maxBytes)
        )
          throw new Error("The selected upload changed");
        checkCancelled(signal, check, deadline);
        entry = {
          version: 1,
          id: `u-${randomUUID()}`,
          grantId,
          name: path.basename(selectedPath),
          size: Number(initial.size),
          cleanupRequired: false,
        };
        const owned = paths(entry.id, entry.name);
        // Journal first. A crash before or during copying still has an owner.
        journal = await fs.open(owned.record, "wx", 0o600);
        entries.set(entry.id, entry);
        await journal.writeFile(
          JSON.stringify({
            version: entry.version,
            id: entry.id,
            grantId: entry.grantId,
            name: entry.name,
            size: entry.size,
          }),
        );
        await journal.sync();
        await journal.close();
        journal = undefined;
        await fs.mkdir(owned.directory, { mode: 0o700 });
        output = await fs.open(owned.file, "wx", 0o600);
        const buffer = Buffer.alloc(CHUNK_BYTES);
        let copied = 0;
        for (;;) {
          checkCancelled(signal, check, deadline);
          const length = Math.min(buffer.length, maxBytes - copied + 1);
          const { bytesRead } = await source.read(buffer, 0, length, copied);
          if (bytesRead === 0) break;
          if (copied + bytesRead > maxBytes)
            throw new Error("The selected upload exceeds 32 MiB");
          let written = 0;
          while (written < bytesRead) {
            checkCancelled(signal, check, deadline);
            const result = await output.write(
              buffer,
              written,
              bytesRead - written,
              copied + written,
            );
            if (result.bytesWritten === 0)
              throw new Error("Browser upload staging could not write");
            written += result.bytesWritten;
          }
          copied += bytesRead;
        }
        const final = await source.stat({ bigint: true });
        if (
          copied !== Number(initial.size) ||
          final.size !== initial.size ||
          final.mtimeNs !== initial.mtimeNs ||
          final.ctimeNs !== initial.ctimeNs
        )
          throw new Error("The selected upload changed during staging");
        await output.chmod(0o400);
        await output.sync();
        checkCancelled(signal, check, deadline);
      } catch (error) {
        failure = error;
      }
      try {
        await journal?.close();
      } catch (error) {
        failure ??= error;
      }
      try {
        await output?.close();
      } catch (error) {
        failure ??= error;
      }
      try {
        await source.close();
      } catch (error) {
        failure ??= error;
      }
      if (failure) {
        if (entry && entries.has(entry.id)) {
          try {
            await cleanupEntry(entry);
          } catch {
            throw new Error(
              "Browser upload staging failed; cleanup recovery is required",
            );
          }
        }
        throw new Error("Browser upload could not be staged");
      }
      return {
        id: entry.id,
        path: paths(entry.id, entry.name).file,
        name: entry.name,
        size: entry.size,
      };
    });
  }

  return {
    stage,
    recover: () => exclusive(retryCleanup),
    cleanup: (id) => {
      const known = entries.get(id);
      if (known) known.cleanupRequired = true;
      return exclusive(async () => {
        await initialize();
        const entry = entries.get(id);
        if (entry) await cleanupEntry(entry);
      });
    },
    cleanupAll: () => {
      for (const entry of entries.values()) entry.cleanupRequired = true;
      return exclusive(async () => {
        await initialize();
        for (const entry of [...entries.values()]) await cleanupEntry(entry);
      });
    },
    pending: () =>
      [...entries.values()].map(({ id, grantId, size, cleanupRequired }) => ({
        id,
        grantId,
        size,
        cleanupRequired,
      })),
  };
}
