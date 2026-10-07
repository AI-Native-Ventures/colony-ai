import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { broadWindowsPrincipals, inspectWindowsAcl } from "./windows-acl.mjs";
import { createChatGptStore } from "./store.mjs";
import { ChatGptError } from "./policy.mjs";

const PRIVATE =
  "D:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;S-1-5-21-1-2-3-1001)";

test("ACL inspection finds every broad SID alias and any granted access", () => {
  for (const [sid, principal] of [
    ["WD", "Everyone"],
    ["S-1-1-0", "Everyone"],
    ["AU", "Authenticated Users"],
    ["S-1-5-11", "Authenticated Users"],
    ["BU", "Users / BUILTIN\\Users"],
    ["S-1-5-32-545", "Users / BUILTIN\\Users"],
  ]) {
    for (const type of ["A", "OA", "XA", "ZA"]) {
      const found = broadWindowsPrincipals(
        `file\r\n${PRIVATE}(${type};OICIIO;RC;;;${sid})\r\n`,
      );
      assert.equal(found.length, 1);
      assert.ok(
        found[0].startsWith(principal),
        `missing broad principal ${sid}`,
      );
    }
  }
  assert.deepEqual(broadWindowsPrincipals(PRIVATE), []);
  assert.deepEqual(
    broadWindowsPrincipals(`${PRIVATE}(D;;FA;;;WD)(A;;0x0;;;AU)`),
    [],
  );
});

test("missing, null, empty, conditional or malformed ACL data fails closed", () => {
  for (const value of [
    "",
    "D:",
    "D:NO_ACCESS_CONTROL",
    `${PRIVATE}\n${PRIVATE}`,
    "D:(A;;FR;;WD)",
    "D:(A;;FR;;;WD)unparsed",
    "D:(XA;;FR;;;WD;(x==1))",
    "D:(AU;;FR;;;WD)",
  ]) {
    assert.throws(() => broadWindowsPrincipals(value), /windows_acl_invalid/);
  }
});

test("icacls reads UTF-16 SID data with 30s deadline, one timeout retry and cleanup", () => {
  let calls = 0;
  let outputPath;
  const found = inspectWindowsAcl("C:\\private profile\\accounts.json", {
    execute(binary, args, options) {
      assert.ok(binary.endsWith("\\System32\\icacls.exe"));
      assert.equal(options.timeout, 30_000);
      assert.equal(options.maxBuffer, 16 * 1024);
      assert.equal(options.windowsHide, true);
      assert.deepEqual(args.slice(0, 2), [
        "C:\\private profile\\accounts.json",
        "/save",
      ]);
      outputPath = args[2];
      assert.equal(args[3], "/q");
      if (++calls === 1)
        throw Object.assign(new Error("cold start"), { code: "ETIMEDOUT" });
      writeFileSync(
        outputPath,
        Buffer.from(
          `\uFEFFaccounts.json\r\n${PRIVATE}(A;;FR;;;AU)\r\n`,
          "utf16le",
        ),
      );
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(found, ["Authenticated Users (S-1-5-11)"]);
  assert.throws(() => readFileSync(outputPath), { code: "ENOENT" });
});

test("persistent timeout is bounded, command failure is not retried, neither yields an empty ACL", () => {
  for (const [code, expected] of [
    ["ETIMEDOUT", 2],
    ["EACCES", 1],
  ]) {
    let calls = 0;
    let outputPath;
    assert.throws(
      () =>
        inspectWindowsAcl("credentials", {
          execute(_binary, args) {
            outputPath = args[2];
            calls++;
            writeFileSync(outputPath, `credentials\n${PRIVATE}`);
            throw Object.assign(new Error("failure"), { code });
          },
        }),
      /windows_acl_inspection_failed/,
    );
    assert.equal(calls, expected);
    assert.throws(() => readFileSync(outputPath), { code: "ENOENT" });
  }
});

test("oversized ACL output fails closed and its scratch file is removed", () => {
  let outputPath;
  assert.throws(
    () =>
      inspectWindowsAcl("credentials", {
        execute(_binary, args) {
          outputPath = args[2];
          writeFileSync(outputPath, Buffer.alloc(16 * 1024 + 1));
        },
      }),
    /windows_acl_invalid/,
  );
  assert.throws(() => readFileSync(outputPath), { code: "ENOENT" });
});

function storeFixture(t, inspectAcl) {
  const userData = mkdtempSync(
    path.join(os.tmpdir(), "colony-chatgpt-acl-store-"),
  );
  t.after(() => rmSync(userData, { recursive: true }));
  return createChatGptStore(userData, { platform: "win32", inspectAcl });
}

test("Windows folder ACL rejection precedes all credential persistence and names principals", async (t) => {
  const store = storeFixture(t, (target) =>
    path.basename(target) === "chatgpt" ? ["Everyone (S-1-1-0)"] : [],
  );
  await assert.rejects(
    store.locked(() => store.hostId()),
    /unsafe_storage: broad principals found: Everyone/,
  );
  assert.deepEqual(readdirSync(store.root), []);
});

test("Windows file ACL rejection precedes reads and preserves the durable snapshot", async (t) => {
  let rejectFile = false;
  const store = storeFixture(t, (target) =>
    rejectFile && target.endsWith("accounts.json")
      ? ["Users / BUILTIN\\Users (S-1-5-32-545)"]
      : [],
  );
  await store.locked(() => store.save(store.snapshot()));
  const file = path.join(store.root, "accounts.json");
  const before = readFileSync(file);
  rejectFile = true;
  await assert.rejects(
    store.locked(() => store.snapshot()),
    /unsafe_storage: broad principals found: Users/,
  );
  assert.deepEqual(readFileSync(file), before);
});

test("unsafe or timed-out temporary-file ACL leaves no secret bytes and preserves prior snapshot", async (t) => {
  for (const fault of ["broad", "timeout"]) {
    let failWrite = false;
    const store = storeFixture(t, (target) => {
      if (!failWrite || !target.endsWith(".tmp")) return [];
      assert.equal(readFileSync(target).length, 0);
      if (fault === "timeout")
        throw new ChatGptError("windows_acl_inspection_failed");
      return ["Authenticated Users (S-1-5-11)"];
    });
    await store.locked(() => store.save(store.snapshot()));
    const file = path.join(store.root, "accounts.json");
    const before = readFileSync(file);
    failWrite = true;
    await assert.rejects(
      store.locked(() => {
        const next = store.snapshot();
        next.secret = "not-to-be-written";
        store.save(next);
      }),
      fault === "timeout"
        ? /windows_acl_inspection_failed/
        : /unsafe_storage: broad principals found: Authenticated Users/,
    );
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(readdirSync(store.root), ["accounts.json"]);
  }
});
