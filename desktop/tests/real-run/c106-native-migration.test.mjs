import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFixture } from "./nest-migration/fixture.mjs";
import { launchNative } from "./c106-native-migration.mjs";

test("native guard proves denial through a noncanonical temp alias before synthetic host exec", {
  skip: process.platform !== "darwin",
}, async () => {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "colony-native-probe-test-"),
  );
  let host;
  try {
    const fixture = await buildFixture({
      root: path.join(base, "fixture"),
      variant: "empty",
    });
    const privateDir = path.join(base, "private");
    await mkdir(privateDir);
    const app = path.join(base, "Synthetic.app");
    const resources = path.join(app, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      path.join(resources, "colony-native-host"),
      "#!/bin/sh\necho SYNTHETIC_HOST_EXECUTED >&2\nexec /bin/cat\n",
      { mode: 0o700 },
    );
    host = await launchNative({
      app,
      fixtureRoot: fixture.root,
      home: fixture.home,
      userDataDir: path.join(privateDir, "user-data"),
      privateDir: privateDir.replace(/^\/private\/var\//u, "/var/"),
      relayUrl: "ws://127.0.0.1:9",
      extraEnv: {},
    });
    let lines = await host.hostLogLines();
    const end = Date.now() + 2000;
    while (
      !lines.some((line) => line.includes("SYNTHETIC_HOST_EXECUTED")) &&
      Date.now() < end
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      lines = await host.hostLogLines();
    }
    assert.ok(lines.some((line) => line.includes("SANDBOX PROBE PASS")));
    assert.ok(lines.some((line) => line.includes("SYNTHETIC_HOST_EXECUTED")));
    assert.equal(await host.window(), undefined);
    await assert.rejects(
      launchNative({
        app,
        fixtureRoot: fixture.root,
        home: fixture.home,
        userDataDir: path.join(privateDir, "user-data"),
        privateDir,
        relayUrl: "ws://127.0.0.1:9",
        extraEnv: { COLONY_NEST_MIGRATION: "0" },
      }),
      /build default/u,
    );
  } finally {
    await host?.quit();
    await rm(base, { recursive: true, force: true });
  }
});
