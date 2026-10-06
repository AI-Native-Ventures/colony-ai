import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REAL_HOME_FORBIDDEN,
  assertFreshHome,
  createFreshHome,
  findNamed,
  freshHomeEnvironment,
  freshHomeSandboxPolicy,
  topLevelNames,
  treeNames,
} from "./fresh-home.mjs";

const REAL = "/Users/realperson";

test("launch environment points HOME at the throwaway directory and never at the real one", () => {
  const env = freshHomeEnvironment(
    {
      HOME: REAL,
      PATH: "/usr/bin",
      USER: "realperson",
      GH_TOKEN: "secret",
      ANTHROPIC_API_KEY: "secret",
      BUZZ_PRIVATE_KEY: "secret",
      COLONY_NATIVE_HOST: "x",
      CLAUDE_CONFIG_DIR: `${REAL}/.claude`,
      DEBUG: "*",
      CI: "1",
    },
    {
      home: "/private/tmp/fresh",
      userDataDir: "/private/tmp/fresh-data",
      relayUrl: "https://relay.example.com",
    },
  );
  assert.equal(env.HOME, "/private/tmp/fresh");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.USER, "realperson");
  assert.equal(env.COLONY_ELECTRON_USER_DATA, "/private/tmp/fresh-data");
  assert.equal(env.COLONY_ELECTRON_BACKGROUND, "1");
  assert.equal(env.BUZZ_RELAY_URL, "https://relay.example.com");
  for (const key of [
    "GH_TOKEN",
    "ANTHROPIC_API_KEY",
    "BUZZ_PRIVATE_KEY",
    "COLONY_NATIVE_HOST",
    "CLAUDE_CONFIG_DIR",
    "DEBUG",
    "CI",
  ])
    assert.equal(key in env, false, key);
  assert.ok(!Object.values(env).some((value) => value === REAL));
});

test("a Claude config directory is forwarded only when the operator names one", () => {
  const base = {
    home: "/private/tmp/fresh",
    userDataDir: "/private/tmp/d",
    relayUrl: "https://relay.example.com",
  };
  assert.equal("CLAUDE_CONFIG_DIR" in freshHomeEnvironment({}, base), false);
  assert.equal(
    freshHomeEnvironment({}, { ...base, claudeConfigDir: "/private/tmp/cc" })
      .CLAUDE_CONFIG_DIR,
    "/private/tmp/cc",
  );
});

test("the environment refuses a missing or relative HOME", () => {
  for (const home of [undefined, "", "relative/dir"])
    assert.throws(
      () =>
        freshHomeEnvironment({}, { home, userDataDir: "/x", relayUrl: "u" }),
      /absolute throwaway HOME/u,
    );
});

test("the sandbox denies every real product folder, the keychains and the security daemon", () => {
  const policy = freshHomeSandboxPolicy(REAL);
  for (const entry of REAL_HOME_FORBIDDEN)
    assert.ok(
      policy.includes(
        `(deny file-read* file-write* (subpath ${JSON.stringify(path.join(REAL, entry))}))`,
      ),
      entry,
    );
  assert.ok(policy.includes('(subpath "/Library/Keychains")'));
  assert.ok(policy.includes('(global-name "com.apple.securityd")'));
  assert.ok(
    policy.includes(
      '(allow process-exec (literal "/usr/bin/security") (with no-sandbox))',
    ),
  );
  assert.ok(policy.startsWith("(version 1)\n(allow default)"));
  // The policy must name the old and the new product folder under the REAL home.
  assert.ok(policy.includes(`${REAL}/.buzz"`));
  assert.ok(policy.includes(`${REAL}/.colony"`));
});

test("assertFreshHome rejects anything that could reach real data", () => {
  const ok = path.join(os.tmpdir(), "colony-fresh-x");
  assert.equal(assertFreshHome({ home: ok, realHome: REAL }), path.resolve(ok));
  for (const home of [
    REAL,
    `${REAL}/.buzz`,
    `${REAL}/.colony/inner`,
    `${REAL}/Library/Keychains`,
    `${REAL}/Documents/fresh`,
  ])
    assert.throws(
      () => assertFreshHome({ home, realHome: REAL }),
      /HOME/u,
      home,
    );
  assert.throws(
    () => assertFreshHome({ home: "relative", realHome: REAL }),
    /absolute/u,
  );
  for (const name of [".buzz", ".colony"])
    assert.throws(
      () => assertFreshHome({ home: ok, realHome: REAL, existing: [name] }),
      /already contains/u,
      name,
    );
});

test("createFreshHome makes a private directory outside the real home with no product folder", async () => {
  const { home, before } = await createFreshHome({ realHome: REAL });
  try {
    assert.ok(!home.startsWith(`${REAL}${path.sep}`));
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.deepEqual(before, ["Library"]);
    assert.deepEqual(await topLevelNames(home), ["Library"]);
    const second = await createFreshHome({ realHome: REAL });
    assert.notEqual(second.home, home);
    await rm(second.home, { recursive: true, force: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("createFreshHome refuses a parent inside the real home", async () => {
  const realHome = await mkdtemp(path.join(os.tmpdir(), "colony-real-home-"));
  try {
    await assert.rejects(
      createFreshHome({ realHome, parent: realHome }),
      /inside the real HOME/u,
    );
  } finally {
    await rm(realHome, { recursive: true, force: true });
  }
});

test("tree names are bounded, relative, names only", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-tree-"));
  try {
    await mkdir(path.join(dir, ".colony", "GUIDES", "deep", "deeper"), {
      recursive: true,
    });
    await writeFile(path.join(dir, ".colony", "AGENTS.md"), "SECRET CONTENT");
    const names = await treeNames(dir, { maxDepth: 2 });
    assert.deepEqual(names, [
      ".colony/",
      ".colony/AGENTS.md",
      ".colony/GUIDES/",
    ]);
    assert.ok(!names.join("\n").includes("SECRET"));
    assert.equal((await treeNames(dir, { maxEntries: 1 })).length, 1);
    assert.deepEqual(await treeNames(path.join(dir, "missing")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findNamed reports links and files by name, relative path and target name only", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-find-"));
  try {
    await mkdir(path.join(dir, "bin"), { recursive: true });
    await writeFile(path.join(dir, "bin", "sidecar"), "BINARY CONTENT");
    await symlink(
      path.join(dir, "bin", "sidecar"),
      path.join(dir, "bin", "colony"),
    );
    await writeFile(path.join(dir, "bin", "buzz"), "x");
    await writeFile(path.join(dir, "bin", "other"), "x");
    const found = await findNamed([dir], ["colony", "buzz"]);
    assert.deepEqual(
      found.map((f) => `${f.rel}:${f.kind}:${f.target}`).sort(),
      ["bin/buzz:file:", "bin/colony:link:sidecar"],
    );
    assert.ok(!JSON.stringify(found).includes("BINARY CONTENT"));
    assert.deepEqual(
      await findNamed([path.join(dir, "missing")], ["colony"]),
      [],
    );
    assert.equal(
      (await findNamed([dir], ["colony", "buzz"], { maxEntries: 1 })).length <=
        1,
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
