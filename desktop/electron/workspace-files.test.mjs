import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspaceFileService,
  MAX_WORKSPACE_FILE_BYTES,
  workspaceFileCandidate,
} from "./workspace-files.mjs";

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colony-file-links-"));
  const root = path.join(base, "workspace");
  await mkdir(path.join(root, "RESEARCH"), { recursive: true });
  await writeFile(
    path.join(root, "DAY1_VIDEO_PACK.md"),
    "# Day one\n\n- Film\n- Publish\n",
  );
  await writeFile(
    path.join(root, "RESEARCH", "notes.md"),
    "## Research\nActual file content",
  );
  const calls = [];
  const service = createWorkspaceFileService({
    invoke: async (command, args) => {
      calls.push({ command, args });
      assert.equal(command, "get_agent_workspace_root");
      if (
        args.agentPubkey !== "local-agent" ||
        args.expectedRelayUrl !== "https://community.example"
      )
        throw new Error("No workspace");
      return root;
    },
  });
  t.after(() => rm(base, { recursive: true, force: true }));
  return {
    base,
    root,
    service,
    calls,
    args: (file) => ({
      agentPubkey: "local-agent",
      expectedRelayUrl: "https://community.example",
      path: file,
    }),
  };
}

test("recognizes filenames and path line references, rejects URLs and control inputs", () => {
  for (const value of ["DAY1_VIDEO_PACK.md", "RESEARCH/notes.md"])
    assert.equal(workspaceFileCandidate(value), value);
  assert.equal(
    workspaceFileCandidate("RESEARCH/notes.md:12:3"),
    "RESEARCH/notes.md",
  );
  for (const value of [
    "https://evil.example/file.md",
    "file:///etc/passwd",
    "a\0.md",
    "a\\b.md",
    "x".repeat(1025),
  ])
    assert.equal(workspaceFileCandidate(value), null);
});

test("production service resolves and reads real files, forwarding author and community", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.resolve(f.args("DAY1_VIDEO_PACK.md")), {
    path: "DAY1_VIDEO_PACK.md",
  });
  assert.deepEqual(await f.service.read(f.args("RESEARCH/notes.md:12")), {
    path: "RESEARCH/notes.md",
    content: "## Research\nActual file content",
  });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[0].args, {
    agentPubkey: "local-agent",
    expectedRelayUrl: "https://community.example",
  });
});

test("missing files and domain references are null, not fabricated links", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "missing.md",
    "colony-ai.colony.ainative.ventures",
    "RESEARCH",
  ])
    assert.equal(await f.service.resolve(f.args(name)), null);
});

test("rejects wrong author or community on both resolve and read", async (t) => {
  const f = await fixture(t);
  for (const args of [
    { ...f.args("DAY1_VIDEO_PACK.md"), agentPubkey: "remote-agent" },
    {
      ...f.args("DAY1_VIDEO_PACK.md"),
      expectedRelayUrl: "https://other.example",
    },
  ]) {
    assert.equal(await f.service.resolve(args), null);
    await assert.rejects(f.service.read(args), /no longer available/);
  }
});

test("rejects traversal, absolute escape and symlink escape on resolve and read", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, "outside.md");
  await writeFile(outside, "Not workspace content");
  await symlink(outside, path.join(f.root, "escape.md"));
  await symlink(f.base, path.join(f.root, "escape-dir"));
  for (const name of [
    "../outside.md",
    outside,
    "escape.md",
    "escape-dir/outside.md",
  ]) {
    assert.equal(await f.service.resolve(f.args(name)), null);
    await assert.rejects(f.service.read(f.args(name)), /no longer available/);
  }
});

test("rejects hidden and credential paths, oversized files and binary content", async (t) => {
  const f = await fixture(t);
  for (const name of [
    ".env.json",
    "credentials.json",
    "private-key.txt",
    "managed-agents.json",
  ]) {
    await writeFile(path.join(f.root, name), "Synthetic protected content");
    assert.equal(await f.service.resolve(f.args(name)), null);
    await assert.rejects(f.service.read(f.args(name)), /no longer available/);
  }
  await writeFile(
    path.join(f.root, "large.md"),
    Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1, 65),
  );
  assert.equal(await f.service.resolve(f.args("large.md")), null);
  await assert.rejects(
    f.service.read(f.args("large.md")),
    /no longer available/,
  );
  await writeFile(path.join(f.root, "binary.txt"), Buffer.from([65, 0, 66]));
  await assert.rejects(
    f.service.read(f.args("binary.txt")),
    /no longer available/,
  );
  await writeFile(path.join(f.root, "invalid.txt"), Buffer.from([255]));
  await assert.rejects(
    f.service.read(f.args("invalid.txt")),
    /no longer available/,
  );
});

test("rechecks after resolution: deletion and replacement cannot read outside", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "DAY1_VIDEO_PACK.md");
  assert.ok(await f.service.resolve(f.args("DAY1_VIDEO_PACK.md")));
  await rm(file);
  await assert.rejects(
    f.service.read(f.args("DAY1_VIDEO_PACK.md")),
    /no longer available/,
  );
  const outside = path.join(f.base, "outside.md");
  await writeFile(outside, "Not workspace content");
  await symlink(outside, file);
  await assert.rejects(
    f.service.read(f.args("DAY1_VIDEO_PACK.md")),
    /no longer available/,
  );
});

test("symlink aliases cannot expose protected files inside the workspace", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.root, ".env.json"),
    "Synthetic protected content",
  );
  await symlink(
    path.join(f.root, ".env.json"),
    path.join(f.root, "public.json"),
  );
  assert.equal(await f.service.resolve(f.args("public.json")), null);
  await assert.rejects(
    f.service.read(f.args("public.json")),
    /no longer available/,
  );
});

test("scope revoked during the read cannot return content", async (t) => {
  const f = await fixture(t);
  let reads = 0;
  const service = createWorkspaceFileService({
    invoke: async () => {
      if (++reads === 2) throw new Error("Community changed");
      return f.root;
    },
  });
  await assert.rejects(
    service.read(f.args("DAY1_VIDEO_PACK.md")),
    /no longer available/,
  );
  assert.equal(reads, 2);
});

test("root symlink replacement is rejected", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.base, "alias");
  await symlink(f.root, alias);
  const service = createWorkspaceFileService({ invoke: async () => alias });
  assert.equal(await service.resolve(f.args("DAY1_VIDEO_PACK.md")), null);
  await assert.rejects(
    service.read(f.args("DAY1_VIDEO_PACK.md")),
    /no longer available/,
  );
});

test("real workspace filenames containing spaces remain openable", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "Day one notes.md"), "# Day one notes");
  assert.deepEqual(await f.service.resolve(f.args("Day one notes.md")), {
    path: "Day one notes.md",
  });
  assert.equal(
    (await f.service.read(f.args("Day one notes.md"))).content,
    "# Day one notes",
  );
});
