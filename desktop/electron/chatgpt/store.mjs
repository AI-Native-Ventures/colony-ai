import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ChatGptError, validClientId } from "./policy.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const EMPTY = () => ({
  version: 1,
  active: null,
  revision: 0,
  accounts: [],
  pending: [],
});
const STATES = new Set([
  "active",
  "plan_use_off",
  "needs_sign_in",
  "pending_revoke",
  "disconnected",
]);

/** Stable registration identity, independent of email and safe for metadata. */
export function accountId(clientId, subject) {
  return createHash("sha256")
    .update(JSON.stringify([clientId, subject]))
    .digest("hex");
}

/** Private atomic snapshots with one installation-wide cross-process writer lock. */
export function createChatGptStore(userData, { lockTimeoutMs = 15_000 } = {}) {
  const root = path.join(userData, "chatgpt");
  const lockPath = path.join(root, "writer.lock");
  const lockOwner = `${process.pid}-${randomUUID()}.json`;
  let queue = Promise.resolve();
  function assertPrivate(stat, directory = false) {
    if (directory ? !stat.isDirectory() : !stat.isFile())
      throw new ChatGptError("unsafe_storage");
    if (
      process.platform !== "win32" &&
      ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
        stat.uid !== process.getuid())
    )
      throw new ChatGptError("unsafe_storage");
    if (!directory && stat.nlink !== 1)
      throw new ChatGptError("unsafe_storage");
  }
  function prepare() {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(root);
    if (stat.isSymbolicLink()) throw new ChatGptError("unsafe_storage");
    assertPrivate(stat, true);
  }
  function read(name) {
    let fd;
    try {
      fd = openSync(
        path.join(root, name),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const stat = fstatSync(fd);
      assertPrivate(stat);
      if (stat.size > MAX_BYTES) throw new ChatGptError("storage_too_large");
      return JSON.parse(readFileSync(fd, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error instanceof ChatGptError
        ? error
        : new ChatGptError("storage_read_failed");
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  function write(name, data) {
    const contents = JSON.stringify(data);
    if (Buffer.byteLength(contents) > MAX_BYTES)
      throw new ChatGptError("storage_too_large");
    const temp = path.join(root, `.${randomUUID()}.tmp`);
    let fd;
    let failure;
    try {
      fd = openSync(temp, "wx", 0o600);
      writeFileSync(fd, contents);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, path.join(root, name));
      if (process.platform !== "win32") {
        const directory = openSync(root, "r");
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
    } catch {
      failure = new ChatGptError("storage_write_failed");
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temp);
      } catch (error) {
        if (error.code !== "ENOENT")
          failure ??= new ChatGptError("storage_cleanup_failed");
      }
    }
    if (failure) throw failure;
  }
  function snapshot() {
    const state = read("accounts.json") ?? EMPTY();
    if (
      state.version !== 1 ||
      !Number.isSafeInteger(state.revision) ||
      !Array.isArray(state.accounts) ||
      state.accounts.length > 16 ||
      !Array.isArray(state.pending) ||
      state.pending.length > 16
    )
      throw new ChatGptError("invalid_registry");
    const seen = new Set();
    for (const account of state.accounts) {
      if (
        !validClientId(account.client_id) ||
        typeof account.subject !== "string" ||
        !account.subject ||
        account.id !== accountId(account.client_id, account.subject) ||
        seen.has(account.id) ||
        !STATES.has(account.state) ||
        !Number.isSafeInteger(account.generation)
      )
        throw new ChatGptError("invalid_registry");
      seen.add(account.id);
    }
    if (state.active !== null && !seen.has(state.active))
      throw new ChatGptError("invalid_registry");
    for (const pending of state.pending) {
      if (
        !validClientId(pending.client_id) ||
        !/^[a-f0-9]{64}$/.test(pending.id)
      )
        throw new ChatGptError("invalid_registry");
    }
    return state;
  }
  function save(state) {
    state.revision++;
    write("accounts.json", state);
  }
  async function acquire() {
    prepare();
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        const fd = openSync(path.join(lockPath, lockOwner), "wx", 0o600);
        try {
          writeFileSync(
            fd,
            JSON.stringify({ pid: process.pid, owner: randomUUID() }),
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return;
      } catch (error) {
        if (error.code !== "EEXIST")
          throw new ChatGptError("storage_lock_failed");
      }
      try {
        const owners = readdirSync(lockPath);
        for (const owner of owners) {
          const match = /^(\d+)-[a-f0-9-]+\.json$/.exec(owner);
          if (!match) throw new ChatGptError("storage_lock_failed");
          try {
            process.kill(Number(match[1]), 0);
          } catch (error) {
            if (error.code === "ESRCH") {
              // Delete only the dead owner's unique file. Concurrent reapers
              // cannot remove the next writer's differently named owner file.
              try {
                unlinkSync(path.join(lockPath, owner));
              } catch (failure) {
                if (failure.code !== "ENOENT") throw failure;
              }
              try {
                rmdirSync(lockPath);
              } catch (failure) {
                if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(failure.code))
                  throw failure;
              }
            }
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new ChatGptError("storage_lock_failed");
      }
      if (Date.now() >= deadline) throw new ChatGptError("storage_busy");
      await delay(25);
    }
  }
  function locked(operation) {
    const next = queue.then(async () => {
      await acquire();
      try {
        return await operation();
      } finally {
        unlinkSync(path.join(lockPath, lockOwner));
        rmdirSync(lockPath);
      }
    });
    queue = next.catch(() => {});
    return next;
  }
  function hostId() {
    const existing = read("host.json");
    if (existing) {
      if (
        !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          existing.id,
        )
      )
        throw new ChatGptError("invalid_host_id");
      return existing.id;
    }
    const id = `urn:uuid:${randomUUID()}`;
    write("host.json", { id });
    return id;
  }
  return { root, locked, snapshot, save, hostId };
}
