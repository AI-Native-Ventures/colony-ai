import assert from "node:assert/strict";
import test from "node:test";

import { mapSpecializedAskCard, needsMeAskLabel } from "./askCardMapping.ts";

test("specialized cards map only verified approval categories", () => {
  assert.equal(
    mapSpecializedAskCard({ type: "approval", category: "general" }),
    null,
  );
  assert.equal(
    mapSpecializedAskCard({ type: "approval", category: "secret" }),
    null,
  );
  assert.equal(
    mapSpecializedAskCard({ type: "question", category: "money" }),
    null,
  );
  assert.equal(
    mapSpecializedAskCard({ type: "approval", category: "money" })?.kind,
    "funding",
  );
  assert.equal(
    mapSpecializedAskCard({ type: "approval", category: "tool" })?.kind,
    "tool",
  );
  assert.deepEqual(
    mapSpecializedAskCard({ type: "tool_consent", category: "tool" }),
    {
      kind: "tool",
      listLabel: "Tool consent",
      decisionTitle: "Tool consent",
      submitLabel: "Record tool decision",
    },
  );
  assert.equal(
    mapSpecializedAskCard({ type: "approval", category: "hire" })?.kind,
    "hire",
  );
});

test("Needs me labels keep category approvals recognizable", () => {
  assert.equal(
    needsMeAskLabel({ type: "approval", category: "money" }),
    "Budget",
  );
  assert.equal(
    needsMeAskLabel({ type: "approval", category: "tool" }),
    "Tool consent",
  );
  assert.equal(
    needsMeAskLabel({ type: "tool_consent", category: "tool" }),
    "Tool consent",
  );
  assert.equal(
    needsMeAskLabel({ type: "approval", category: "hire" }),
    "Approval",
  );
  assert.equal(
    needsMeAskLabel({ type: "choice", category: "general" }),
    "choice",
  );
});
