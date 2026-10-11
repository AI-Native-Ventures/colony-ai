import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUploadStagingStore } from "./upload-staging.mjs";

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "colony-upload-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const selected = path.join(directory, "selected.txt");
  await fs.writeFile(selected, "approved bytes");
  const rootPath = path.join(directory, "staging");
  return {
    directory,
    selected,
    rootPath,
    store: createUploadStagingStore({ rootPath, ...options }),
  };
}

test("staged bytes stay immutable after original replacement with private ownership", async (t) => {
  const f = await fixture(t);
  const staged = await f.store.stage("grant", f.selected);
  assert.match(staged.id, /^u-[0-9a-f-]{36}$/u);
  assert.equal(staged.name, "selected.txt");
  assert.equal(staged.size, 14);
  await fs.rename(f.selected, `${f.selected}.old`);
  await fs.writeFile(f.selected, "replacement attacker bytes");
  assert.equal(await fs.readFile(staged.path, "utf8"), "approved bytes");
  const recordPath = path.join(f.rootPath, "records", `${staged.id}.json`);
  const record = await fs.readFile(recordPath, "utf8");
  assert.ok(!record.includes(f.selected));
  assert.ok(!record.includes(staged.path));
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(f.rootPath)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(recordPath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(staged.path)).mode & 0o777, 0o400);
  }
  await f.store.recover();
  assert.equal(
    await fs.readFile(staged.path, "utf8"),
    "approved bytes",
    "live files survive recovery",
  );
  await f.store.cleanup(staged.id);
  assert.deepEqual(f.store.pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
  assert.equal(
    await fs.readFile(f.selected, "utf8"),
    "replacement attacker bytes",
  );
});

test("directories, symlinks and oversized files are refused before copying", async (t) => {
  const f = await fixture(t, { maxBytes: 8 });
  await assert.rejects(f.store.stage("grant", f.selected), /regular file/);
  await assert.rejects(f.store.stage("grant", f.directory), /regular file/);
  if (process.platform !== "win32") {
    const link = path.join(f.directory, "symlink.txt");
    await fs.symlink(f.selected, link);
    await assert.rejects(f.store.stage("grant", link), /regular file/);
  }
  assert.deepEqual(f.store.pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
});

test("capacity stays bounded while live files remain available", async (t) => {
  const f = await fixture(t, { maxEntries: 2 });
  const first = await f.store.stage("first", f.selected);
  const second = await f.store.stage("second", f.selected);
  await assert.rejects(f.store.stage("third", f.selected), /limit/);
  await f.store.cleanup(first.id);
  const third = await f.store.stage("third", f.selected);
  assert.equal(await fs.readFile(second.path, "utf8"), "approved bytes");
  assert.equal(await fs.readFile(third.path, "utf8"), "approved bytes");
  await f.store.cleanupAll();
  assert.deepEqual(f.store.pending(), []);
});

for (const step of ["payload-directory", "journal"]) {
  test(`failed ${step} cleanup retains a record recoverable by a new store`, async (t) => {
    const f = await fixture(t);
    let fail = false;
    const injected = {
      ...fs,
      rmdir: async (directory) => {
        if (fail && step === "payload-directory")
          throw Object.assign(new Error("fixture failure"), { code: "EACCES" });
        return fs.rmdir(directory);
      },
      unlink: async (file) => {
        if (fail && step === "journal" && file.endsWith(".json"))
          throw Object.assign(new Error("fixture failure"), { code: "EACCES" });
        return fs.unlink(file);
      },
    };
    const store = createUploadStagingStore({
      rootPath: f.rootPath,
      fs: injected,
    });
    const staged = await store.stage("grant", f.selected);
    fail = true;
    await assert.rejects(store.cleanup(staged.id), /fixture failure/);
    assert.equal(store.pending()[0].cleanupRequired, true);
    assert.equal(
      (await fs.readdir(path.join(f.rootPath, "records"))).length,
      1,
    );
    const recovered = createUploadStagingStore({ rootPath: f.rootPath });
    await recovered.recover();
    assert.deepEqual(recovered.pending(), []);
    assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
    assert.deepEqual(await fs.readdir(path.join(f.rootPath, "payloads")), []);
    assert.equal(await fs.readFile(f.selected, "utf8"), "approved bytes");
  });
}

test("unexpected payload contents are retained with their recovery record", async (t) => {
  const f = await fixture(t);
  const staged = await f.store.stage("grant", f.selected);
  const unknown = path.join(path.dirname(staged.path), "unexpected.txt");
  await fs.writeFile(unknown, "do not delete");
  await assert.rejects(f.store.cleanup(staged.id));
  const recovered = createUploadStagingStore({ rootPath: f.rootPath });
  await assert.rejects(recovered.recover());
  assert.equal(await fs.readFile(unknown, "utf8"), "do not delete");
  assert.equal((await fs.readdir(path.join(f.rootPath, "records"))).length, 1);
  await fs.unlink(unknown);
  await recovered.recover();
  assert.deepEqual(recovered.pending(), []);
});

test("replacement between inspection and open cannot stage another inode", async (t) => {
  const f = await fixture(t);
  const injected = {
    ...fs,
    open: async (file, ...args) => {
      if (file === f.selected) {
        await fs.rename(file, `${file}.before`);
        await fs.writeFile(file, "replaced");
      }
      return fs.open(file, ...args);
    },
  };
  const store = createUploadStagingStore({
    rootPath: f.rootPath,
    fs: injected,
  });
  await assert.rejects(store.stage("grant", f.selected), /could not be staged/);
  assert.deepEqual(store.pending(), []);
});

test("growing sources are bounded and incomplete staging is cleaned", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.selected, "small");
  let writtenBytes = 0;
  const injected = {
    ...fs,
    open: async (file, ...args) => {
      const handle = await fs.open(file, ...args);
      if (file === f.selected) {
        const read = handle.read.bind(handle);
        let first = true;
        handle.read = async (...parameters) => {
          if (first) {
            first = false;
            await fs.appendFile(file, "x".repeat(20));
          }
          return read(...parameters);
        };
      }
      if (args[0] === "wx" && file.includes(`${path.sep}payloads${path.sep}`)) {
        const write = handle.write.bind(handle);
        handle.write = async (...parameters) => {
          const result = await write(...parameters);
          writtenBytes += result.bytesWritten;
          return result;
        };
      }
      return handle;
    },
  };
  const store = createUploadStagingStore({
    rootPath: f.rootPath,
    fs: injected,
    maxBytes: 16,
  });
  await assert.rejects(store.stage("grant", f.selected), /could not be staged/);
  assert.ok(writtenBytes <= 16, "growing source must never write past the cap");
  assert.deepEqual(store.pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "payloads")), []);
});

test("cancellation before copying leaves no payload or ownership record", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.store.stage("grant", f.selected, { signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(f.store.pending(), []);
});

test("invalid and oversized records fail closed without touching payloads", async (t) => {
  const f = await fixture(t);
  const staged = await f.store.stage("grant", f.selected);
  const record = path.join(f.rootPath, "records", `${staged.id}.json`);
  await fs.writeFile(record, "x".repeat(4097));
  const recovered = createUploadStagingStore({ rootPath: f.rootPath });
  await assert.rejects(
    recovered.recover(),
    /Invalid upload staging recovery record/,
  );
  assert.equal(await fs.readFile(staged.path, "utf8"), "approved bytes");
  await fs.writeFile(
    record,
    JSON.stringify({
      version: 1,
      id: staged.id,
      name: "../escape",
      size: 14,
      grantId: "grant",
    }),
  );
  await assert.rejects(
    recovered.recover(),
    /Invalid upload staging recovery record/,
  );
  assert.equal(await fs.readFile(staged.path, "utf8"), "approved bytes");
});

test("a bounded staging deadline prevents a slow copy from returning success", async (t) => {
  const f = await fixture(t);
  let clock = 0;
  const injected = {
    ...fs,
    open: async (file, ...args) => {
      const handle = await fs.open(file, ...args);
      if (file === f.selected) {
        const read = handle.read.bind(handle);
        handle.read = async (...parameters) => {
          const result = await read(...parameters);
          clock = 30_000;
          return result;
        };
      }
      return handle;
    },
  };
  const store = createUploadStagingStore({
    rootPath: f.rootPath,
    fs: injected,
    now: () => clock,
  });
  await assert.rejects(store.stage("grant", f.selected), /could not be staged/);
  assert.deepEqual(store.pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
});

test("bounded main-owned bytes use private journals and the same live-file capacity", async (t) => {
  const f = await fixture(t, { maxBytes: 16, maxEntries: 1 });
  const data = Buffer.from("bounded-download");
  const staged = await f.store.stageBytes("grant", "download.txt", data);
  assert.equal(await fs.readFile(staged.path, "utf8"), "bounded-download");
  assert.equal(staged.size, data.length);
  await assert.rejects(
    f.store.stageBytes("next", "next.txt", Buffer.from("next")),
    /limit/u,
  );
  await f.store.cleanup(staged.id);
  await assert.rejects(
    f.store.stageBytes("grant", "../outside", data),
    /Invalid/u,
  );
  await assert.rejects(
    f.store.stageBytes("grant", "big.txt", Buffer.alloc(17)),
    /Invalid/u,
  );
  assert.deepEqual(f.store.pending(), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
});

test("bounded-byte write failure keeps its journal through failed cleanup and process recovery", async (t) => {
  const f = await fixture(t);
  const injected = {
    ...fs,
    open: async (file, ...args) => {
      const handle = await fs.open(file, ...args);
      if (args[0] === "wx" && file.includes(`${path.sep}payloads${path.sep}`)) {
        const write = handle.write.bind(handle);
        handle.write = async (...parameters) => {
          await write(...parameters);
          throw new Error("injected write failure");
        };
      }
      return handle;
    },
    rmdir: async () => {
      throw new Error("injected cleanup failure");
    },
  };
  const store = createUploadStagingStore({
    rootPath: f.rootPath,
    fs: injected,
  });
  await assert.rejects(
    store.stageBytes("grant", "download.txt", Buffer.from("bytes")),
    /recovery/u,
  );
  assert.equal(store.pending().length, 1);
  assert.equal(store.pending()[0].cleanupRequired, true);
  assert.equal((await fs.readdir(path.join(f.rootPath, "records"))).length, 1);
  const recovered = createUploadStagingStore({ rootPath: f.rootPath });
  await recovered.recover();
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "records")), []);
  assert.deepEqual(await fs.readdir(path.join(f.rootPath, "payloads")), []);
});

test("bounded-byte staging respects cancellation and its deadline before returning authority", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.store.stageBytes("grant", "download.txt", Buffer.from("bytes"), {
      signal: controller.signal,
    }),
    /cancelled/u,
  );
  let clock = 0;
  const injected = {
    ...fs,
    open: async (file, ...args) => {
      const handle = await fs.open(file, ...args);
      if (args[0] === "wx" && file.includes(`${path.sep}payloads${path.sep}`)) {
        const write = handle.write.bind(handle);
        handle.write = async (...parameters) => {
          const result = await write(...parameters);
          clock = 30_000;
          return result;
        };
      }
      return handle;
    },
  };
  const store = createUploadStagingStore({
    rootPath: f.rootPath,
    fs: injected,
    now: () => clock,
  });
  await assert.rejects(
    store.stageBytes("grant", "download.txt", Buffer.from("bytes")),
    /could not be staged/u,
  );
  assert.deepEqual(store.pending(), []);
});
