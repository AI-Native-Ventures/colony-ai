import assert from "node:assert/strict";
import test from "node:test";
import { getWorkspaceFileAuthorPubkey } from "./workspaceFileAuthor.ts";
import { isWorkspaceFileReference } from "./workspaceFiles.ts";

test("file author uses known raw signer, never delegated display author", () => {
  const known = (pubkey) => pubkey === "local-agent";
  assert.equal(
    getWorkspaceFileAuthorPubkey({ signerPubkey: "local-agent" }, known),
    "local-agent",
  );
  assert.equal(
    getWorkspaceFileAuthorPubkey(
      { signerPubkey: "relay", pubkey: "local-agent" },
      known,
    ),
    undefined,
  );
  assert.equal(
    getWorkspaceFileAuthorPubkey({ pubkey: "local-agent" }, known),
    undefined,
  );
});
test("path-like references include bare filenames and domains, ordinary code is preserved", () => {
  for (const text of [
    "DAY1_VIDEO_PACK.md",
    "Day one notes.md",
    "RESEARCH/notes.md",
    "colony-ai.colony.ainative.ventures",
  ])
    assert.equal(isWorkspaceFileReference(text), true);
  for (const text of ["draft", "const value = 1", "x".repeat(1025), "a\0.md"])
    assert.equal(isWorkspaceFileReference(text), false);
});
