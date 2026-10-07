import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspaceFileService,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_LIST_ENTRIES,
  WORKSPACE_FILE_COMMANDS,
  workspaceDirectoryCandidate,
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

const names = (listing) => listing.entries.map((entry) => entry.name);

test("directory candidates are plain relative folders only", () => {
  for (const value of [undefined, null, "", "."])
    assert.equal(workspaceDirectoryCandidate(value), "");
  assert.equal(workspaceDirectoryCandidate("RESEARCH"), "RESEARCH");
  assert.equal(workspaceDirectoryCandidate("RESEARCH/deep"), "RESEARCH/deep");
  for (const value of [
    "..",
    "../x",
    "RESEARCH/..",
    "RESEARCH/../..",
    "./RESEARCH",
    "/etc",
    "RESEARCH/",
    "RESEARCH//deep",
    "C:\\x",
    "C:x",
    "a\\b",
    " RESEARCH",
    "RESEARCH\n",
    "a\0b",
    "x".repeat(1025),
    42,
    {},
  ])
    assert.equal(workspaceDirectoryCandidate(value), null);
});

test("lists the root and subfolders: folders first, names sorted, paths relative, no content", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, "A-first"));
  await writeFile(path.join(f.root, "b10.md"), "ten");
  await writeFile(path.join(f.root, "b2.md"), "two");
  const root = await f.service.list(f.args(""));
  assert.equal(root.path, "");
  assert.equal(root.truncated, false);
  assert.deepEqual(names(root), [
    "A-first",
    "RESEARCH",
    "b2.md",
    "b10.md",
    "DAY1_VIDEO_PACK.md",
  ]);
  assert.deepEqual(root.entries[1], {
    name: "RESEARCH",
    path: "RESEARCH",
    kind: "dir",
  });
  const day = root.entries.find((entry) => entry.name === "DAY1_VIDEO_PACK.md");
  assert.deepEqual(day, {
    name: "DAY1_VIDEO_PACK.md",
    path: "DAY1_VIDEO_PACK.md",
    kind: "file",
    size: Buffer.byteLength("# Day one\n\n- Film\n- Publish\n"),
  });
  const sub = await f.service.list(f.args("RESEARCH"));
  assert.equal(sub.path, "RESEARCH");
  assert.deepEqual(sub.entries, [
    {
      name: "notes.md",
      path: "RESEARCH/notes.md",
      kind: "file",
      size: Buffer.byteLength("## Research\nActual file content"),
    },
  ]);
  // The listing is what `read` accepts.
  assert.equal(
    (await f.service.read(f.args(sub.entries[0].path))).content,
    "## Research\nActual file content",
  );
  for (const entry of root.entries)
    assert.deepEqual(
      Object.keys(entry).sort(),
      entry.kind === "dir"
        ? ["kind", "name", "path"]
        : ["kind", "name", "path", "size"],
    );
});

test("listing hides hidden, credential-looking, binary and oversized entries", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, ".git"));
  await mkdir(path.join(f.root, "secrets"));
  await mkdir(path.join(f.root, "managed-agents"));
  await writeFile(path.join(f.root, ".env"), "KEY=1");
  await writeFile(path.join(f.root, "auth-token.txt"), "t");
  await writeFile(path.join(f.root, "private_key.md"), "k");
  await writeFile(path.join(f.root, "image.png"), "png");
  await writeFile(path.join(f.root, "archive.zip"), "zip");
  await writeFile(
    path.join(f.root, "big.md"),
    Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1, 97),
  );
  assert.deepEqual(names(await f.service.list(f.args(""))), [
    "RESEARCH",
    "DAY1_VIDEO_PACK.md",
  ]);
});

test("listing never exposes symlink escapes, and shows inside-root links that read accepts", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, "outside.md");
  await writeFile(outside, "Not workspace content");
  await mkdir(path.join(f.base, "outside-dir"));
  await writeFile(path.join(f.base, "outside-dir", "x.md"), "x");
  await symlink(outside, path.join(f.root, "escape.md"));
  await symlink(
    path.join(f.base, "outside-dir"),
    path.join(f.root, "escape-dir"),
  );
  await symlink(
    path.join(f.base, "missing.md"),
    path.join(f.root, "dangling.md"),
  );
  await writeFile(path.join(f.root, ".env"), "KEY=1");
  await symlink(
    path.join(f.root, ".env"),
    path.join(f.root, "alias-to-secret.md"),
  );
  await symlink(
    path.join(f.root, "DAY1_VIDEO_PACK.md"),
    path.join(f.root, "inside-link.md"),
  );
  const listing = await f.service.list(f.args(""));
  assert.deepEqual(names(listing), [
    "RESEARCH",
    "DAY1_VIDEO_PACK.md",
    "inside-link.md",
  ]);
  assert.equal(
    (await f.service.read(f.args("inside-link.md"))).content,
    "# Day one\n\n- Film\n- Publish\n",
  );
  // And a symlinked folder cannot be walked into.
  await assert.rejects(
    f.service.list(f.args("escape-dir")),
    /no longer available/,
  );
});

test("listing rejects traversal, absolute and odd paths, files, hidden and protected folders", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, ".git"));
  await mkdir(path.join(f.root, "secrets"));
  await symlink(f.base, path.join(f.root, "escape-dir"));
  for (const target of [
    "..",
    "RESEARCH/..",
    "../workspace",
    f.base,
    "/",
    "escape-dir",
    ".git",
    "secrets",
    "RESEARCH/notes.md",
    "DAY1_VIDEO_PACK.md",
    "missing",
    "RESEARCH/",
    "a\\b",
    "C:x",
    "x".repeat(1025),
  ])
    await assert.rejects(
      f.service.list(f.args(target)),
      /no longer available/,
      String(target),
    );
});

test("listing rejects the wrong author or community and a replaced root", async (t) => {
  const f = await fixture(t);
  for (const args of [
    { ...f.args(""), agentPubkey: "remote-agent" },
    { ...f.args(""), expectedRelayUrl: "https://other.example" },
  ])
    await assert.rejects(f.service.list(args), /no longer available/);
  const alias = path.join(f.base, "alias");
  await symlink(f.root, alias);
  const aliased = createWorkspaceFileService({ invoke: async () => alias });
  await assert.rejects(aliased.list(f.args("")), /no longer available/);
});

test("scope revoked while listing returns nothing", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const service = createWorkspaceFileService({
    invoke: async () => {
      if (++calls === 2) throw new Error("Community changed");
      return f.root;
    },
  });
  await assert.rejects(service.list(f.args("")), /no longer available/);
  assert.equal(calls, 2);
  const swapped = createWorkspaceFileService({
    invoke: async () => (++calls % 2 === 0 ? f.base : f.root),
  });
  await assert.rejects(swapped.list(f.args("")), /no longer available/);
});

test("a huge folder is cut off at the listing limit and says so", async (t) => {
  const f = await fixture(t);
  const many = path.join(f.root, "many");
  await mkdir(many);
  for (let index = 0; index < MAX_WORKSPACE_LIST_ENTRIES + 20; index += 1)
    await writeFile(
      path.join(many, `f${String(index).padStart(4, "0")}.md`),
      "x",
    );
  const listing = await f.service.list(f.args("many"));
  assert.equal(listing.entries.length, MAX_WORKSPACE_LIST_ENTRIES);
  assert.equal(listing.truncated, true);
});

test("every command the main process answers maps to a real service method", async (t) => {
  const f = await fixture(t);
  assert.deepEqual([...WORKSPACE_FILE_COMMANDS.keys()].sort(), [
    "list_agent_workspace_files",
    "read_agent_workspace_file",
    "resolve_agent_workspace_file",
  ]);
  for (const method of WORKSPACE_FILE_COMMANDS.values())
    assert.equal(typeof f.service[method], "function", method);
});
