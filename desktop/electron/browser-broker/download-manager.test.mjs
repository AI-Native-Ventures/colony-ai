import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createUploadStagingStore } from "./upload-staging.mjs";
import { createBrowserDownloadManager } from "./download-manager.mjs";

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("owned transfer did not retire");
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "colony-download-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingRoot = path.join(root, "staging");
  const downloadsPath = path.join(root, "downloads");
  const staging = createUploadStagingStore({
    rootPath: stagingRoot,
    fs: options.stageFs ?? fs,
  });
  const requests = [];
  const remembered = [];
  let recoveries = 0;
  const manager = createBrowserDownloadManager({
    staging,
    downloadsPath,
    fetchForTab: async (tab, url, init) => {
      requests.push({ tab, url, init });
      return options.fetch
        ? options.fetch(tab, url, init)
        : new Response("approved download bytes");
    },
    remember: (...args) => remembered.push(args),
    onRecovery: () => {
      recoveries += 1;
    },
    ...options.manager,
  });
  const call = (url = "https://approved.example/report.txt", overrides = {}) =>
    manager.download("tab", url, {
      grantId: "grant",
      check: () => {},
      authorize: async (target) => {
        assert.equal(new URL(target).origin, "https://approved.example");
      },
      ...overrides,
    });
  return {
    root,
    stagingRoot,
    downloadsPath,
    staging,
    requests,
    remembered,
    manager,
    call,
    recoveries: () => recoveries,
  };
}

test("complete files publish atomically without overwriting and expose opaque metadata only", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.downloadsPath);
  await fs.writeFile(
    path.join(f.downloadsPath, "report.txt"),
    "person-existing-file",
  );
  const first = await f.call();
  const second = await f.call();
  assert.equal(first.name, "report (1).txt");
  assert.equal(second.name, "report (2).txt");
  assert.equal(
    await fs.readFile(path.join(f.downloadsPath, "report.txt"), "utf8"),
    "person-existing-file",
  );
  assert.equal(
    await fs.readFile(path.join(f.downloadsPath, first.name), "utf8"),
    "approved download bytes",
  );
  assert.deepEqual(Object.keys(first).sort(), [
    "bytes",
    "cleanupRequired",
    "downloadId",
    "name",
  ]);
  assert.equal(first.bytes, Buffer.byteLength("approved download bytes"));
  if (process.platform !== "win32")
    assert.equal(
      (await fs.stat(path.join(f.downloadsPath, first.name))).mode & 0o777,
      0o600,
    );
  assert.ok(!JSON.stringify(first).includes(f.root));
  assert.ok(!JSON.stringify(first).includes("approved download bytes"));
  assert.equal(f.requests[0].init.redirect, "manual");
  assert.equal(f.requests[0].init.credentials, "include");
  assert.equal(f.requests[0].init.method, "GET");
  assert.deepEqual(f.staging.pending(), []);
});

for (const announce of [true, false]) {
  test(`byte cap refuses ${announce ? "announced" : "unannounced"} oversized bodies before staging`, async (t) => {
    const f = await fixture(t, {
      manager: { maxBytes: 8 },
      fetch: async () =>
        new Response("123456789", {
          headers: announce ? { "content-length": "9" } : {},
        }),
    });
    await assert.rejects(f.call(), /byte limit/u);
    assert.deepEqual(f.staging.pending(), []);
    assert.equal(f.remembered.length, 0);
  });
}

test("redirects are authorized before requesting the next origin", async (t) => {
  const f = await fixture(t, {
    fetch: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://unapproved.example/private" },
      }),
  });
  await assert.rejects(f.call());
  assert.equal(f.requests.length, 1);
  assert.equal(f.remembered.length, 0);
});

test("manual redirect count is bounded and Response.url grants no authority", async (t) => {
  const f = await fixture(t, {
    fetch: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "/again" },
      }),
  });
  await assert.rejects(f.call(), /redirect limit/u);
  assert.equal(f.requests.length, 5);
  const safe = await fixture(t, {
    fetch: async () => {
      const response = new Response("bytes");
      Object.defineProperty(response, "url", {
        value: "file:///untrusted-response-value",
      });
      return response;
    },
  });
  assert.equal((await safe.call()).bytes, 5);
});

test("non-web and credential links never reach a session fetch", async (t) => {
  const f = await fixture(t);
  for (const url of [
    "file:///private/secret",
    "data:text/plain,secret",
    "blob:https://approved.example/id",
    "https://user:pass@approved.example/report",
  ])
    await assert.rejects(f.call(url), /Invalid/u);
  assert.equal(f.requests.length, 0);
});

test("aborted slow readers retain a bounded slot until the underlying read retires", async (t) => {
  let source;
  const f = await fixture(t, {
    manager: { maxActive: 1 },
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            source = controller;
          },
        }),
      ),
  });
  const controller = new AbortController();
  const first = f.call(undefined, { signal: controller.signal });
  await until(() => Boolean(source));
  controller.abort();
  await assert.rejects(first, /cancelled/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.call(), /capacity/u);
  source.close();
  await until(() => f.manager.active().length === 0);
  assert.equal(f.remembered.length, 0);
  assert.deepEqual(f.staging.pending(), []);
});

test("a hung fetch has a terminal caller deadline without releasing unlimited abandoned slots", {
  timeout: 1000,
}, async (t) => {
  let finish;
  const f = await fixture(t, {
    manager: { maxActive: 1, deadlineMs: 20 },
    fetch: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await assert.rejects(f.call(), /timed out/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.call(), /capacity/u);
  finish(new Response("too late"));
  await until(() => f.manager.active().length === 0);
  assert.equal(f.remembered.length, 0);
});

test("filename attempts and cross-volume publication fail closed with no partial destination", async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    manager: {
      fs: {
        ...fs,
        link: async () => {
          attempts += 1;
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        },
      },
    },
  });
  await assert.rejects(f.call(), /filename limit/u);
  assert.equal(attempts, 200);
  assert.deepEqual(f.staging.pending(), []);
  const cross = await fixture(t, {
    manager: {
      fs: {
        ...fs,
        link: async () => {
          throw Object.assign(new Error("different volume"), { code: "EXDEV" });
        },
      },
    },
  });
  await assert.rejects(cross.call(), /could not be saved/u);
  assert.deepEqual(cross.staging.pending(), []);
  assert.deepEqual(await fs.readdir(cross.downloadsPath), []);
});

test("completed person files survive cleanup failure and process recovery retains owned journals", async (t) => {
  const f = await fixture(t, {
    stageFs: {
      ...fs,
      rmdir: async () => {
        throw new Error("cleanup failure");
      },
    },
  });
  const result = await f.call();
  assert.equal(result.cleanupRequired, true);
  assert.equal(f.recoveries(), 1);
  assert.equal(f.staging.pending()[0].cleanupRequired, true);
  const recovered = createUploadStagingStore({ rootPath: f.stagingRoot });
  await recovered.recover();
  assert.deepEqual(await fs.readdir(path.join(f.stagingRoot, "records")), []);
  assert.equal(
    await fs.readFile(path.join(f.downloadsPath, result.name), "utf8"),
    "approved download bytes",
  );
});

test("reader cancellation failures retain bounded recovery records until a successful retry", async (t) => {
  let fail = true;
  const reader = {
    read: async () => ({ done: true }),
    cancel: async () => {
      if (fail) throw new Error("cancel failed");
    },
  };
  const f = await fixture(t, {
    manager: { maxActive: 1 },
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    }),
  });
  await assert.rejects(f.call(), /cancellation requires recovery/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.manager.recover(), /cancel failed/u);
  assert.equal(f.manager.active().length, 1);
  fail = false;
  await f.manager.recover();
  assert.equal(f.manager.active().length, 0);
});

test("empty chunk loops are independently bounded before any staging", async (t) => {
  let reads = 0;
  const f = await fixture(t, {
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return { done: false, value: new Uint8Array() };
          },
          cancel: async () => {},
        }),
      },
    }),
  });
  await assert.rejects(f.call(), /stream limit/u);
  assert.equal(reads, 8192);
  assert.deepEqual(f.staging.pending(), []);
});

test("revocation after staging prevents publication and discards only owned bytes", async (t) => {
  const f = await fixture(t);
  let active = true;
  const stageBytes = f.staging.stageBytes;
  f.staging.stageBytes = async (...args) => {
    const file = await stageBytes(...args);
    active = false;
    return file;
  };
  await assert.rejects(
    f.call(undefined, {
      check: () => {
        if (!active) throw new Error("revoked");
      },
    }),
    /revoked/u,
  );
  assert.equal(f.remembered.length, 0);
  assert.deepEqual(f.staging.pending(), []);
  await assert.rejects(fs.readdir(f.downloadsPath), { code: "ENOENT" });
});

test("tab cancellation fences only its transfer and recovery cannot clear a live fetch", async (t) => {
  const waiting = new Map();
  t.after(() => {
    for (const finish of waiting.values())
      finish(new Response("retired fixture"));
  });
  const f = await fixture(t, {
    fetch: (tab) => new Promise((resolve) => waiting.set(tab, resolve)),
  });
  const authority = {
    grantId: "grant",
    check: () => {},
    authorize: async () => {},
  };
  const first = f.manager.download(
    "tab-a",
    "https://approved.example/a.txt",
    authority,
  );
  const second = f.manager.download(
    "tab-b",
    "https://approved.example/b.txt",
    authority,
  );
  first.catch(() => {});
  second.catch(() => {});
  await until(() => waiting.size === 2);
  f.manager.cancelTab("tab-a");
  await assert.rejects(first, /cancelled/u);
  assert.deepEqual(
    f.manager.active().map(({ tabId, aborted }) => ({ tabId, aborted })),
    [
      { tabId: "tab-a", aborted: true },
      { tabId: "tab-b", aborted: false },
    ],
  );
  await assert.rejects(f.manager.recover(), /still stopping/u);
  assert.equal(f.manager.active().length, 2);
  waiting.get("tab-a")(new Response("too late"));
  await until(() => f.manager.active().length === 1);
  waiting.get("tab-b")(new Response("approved"));
  assert.equal((await second).bytes, 8);
  assert.equal(f.manager.active().length, 0);
});

test("stop has a bounded deadline and blocks new work while retaining unretired transfers", async (t) => {
  let finish;
  const f = await fixture(t, {
    fetch: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = f.call();
  await until(() => Boolean(finish));
  const rejection = assert.rejects(pending, /cancelled/u);
  await assert.rejects(f.manager.stop({ timeoutMs: 20 }), /still stopping/u);
  await rejection;
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.call(), /stopped/u);
  finish(new Response("too late"));
  await until(() => f.manager.active().length === 0);
  await f.manager.stop({ timeoutMs: 20 });
  assert.equal(f.remembered.length, 0);
});

test("failed redirect body cancellation retains a recovery record until retry succeeds", async (t) => {
  let fail = true;
  let cancellations = 0;
  const f = await fixture(t, {
    fetch: async () => ({
      status: 302,
      ok: false,
      headers: new Headers({ location: "/again" }),
      body: {
        cancel: async () => {
          cancellations += 1;
          if (fail) throw new Error("redirect body cancel failed");
        },
      },
    }),
  });
  await assert.rejects(f.call(), /cancel failed/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.manager.recover(), /cancel failed/u);
  assert.equal(f.manager.active().length, 1);
  fail = false;
  await f.manager.recover();
  assert.equal(f.manager.active().length, 0);
  assert.ok(cancellations >= 2);
  assert.equal(f.requests.length, 1);
});

test("a hung recovery retry has a bounded caller and retains the same cleanup record", async (t) => {
  let calls = 0;
  let finish;
  const f = await fixture(t, {
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => ({ done: true }),
          cancel: () => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error("cancel failed"));
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        }),
      },
    }),
  });
  await assert.rejects(f.call(), /recovery/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.manager.recover({ timeoutMs: 20 }), /still stopping/u);
  assert.equal(f.manager.active().length, 1);
  await assert.rejects(f.manager.stop({ timeoutMs: 20 }), /still stopping/u);
  assert.equal(calls, 2, "the same in-flight cleanup is reused");
  finish();
  await until(() => f.manager.active().length === 0);
  await f.manager.stop({ timeoutMs: 20 });
});
