import assert from "node:assert/strict";
import test from "node:test";

import {
  KIND_CLIENT_HEAD,
  KIND_DELIVERABLE_APPROVAL,
  KIND_DELIVERABLE_VERSION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";
import {
  parseClientHead,
  parseDeliverableApproval,
  parseDeliverableVersion,
  parseWorkItemHead,
} from "@/features/clients/lib/businessRecords.ts";
import { referenceBusinessRecordEvents } from "./e2eReferenceWorkspace.ts";

test("reference workspace business rows use the production record parsers", () => {
  const events = referenceBusinessRecordEvents("ab".repeat(32));
  const ids = new Set(events.map((event) => event.id));
  const clientHeads = events
    .filter((event) => event.kind === KIND_CLIENT_HEAD)
    .map(parseClientHead);
  const workHeads = events
    .filter((event) => event.kind === KIND_WORK_ITEM_HEAD)
    .map(parseWorkItemHead);
  const versions = events
    .filter((event) => event.kind === KIND_DELIVERABLE_VERSION)
    .map(parseDeliverableVersion);
  const approvals = events
    .filter((event) => event.kind === KIND_DELIVERABLE_APPROVAL)
    .map(parseDeliverableApproval);

  assert.equal(ids.size, events.length);
  assert.equal(clientHeads.length, 3);
  assert.equal(workHeads.length, 3);
  assert.equal(versions.length, 5);
  assert.equal(approvals.length, 3);
  assert.equal(
    approvals.filter((record) => record.value.decision === "approved").length,
    2,
  );
  const changesRequested = approvals.find(
    (record) => record.value.decision === "changes_requested",
  );
  assert.ok(changesRequested);
  assert.equal(changesRequested.value.versionEventId, versions[0].event.id);
  assert.equal(workHeads[0].value.title, "Produce the spring content campaign");
  assert.equal(workHeads[0].value.deliverables.length, 4);
  assert.equal(
    workHeads[0].value.deliverables[0].versionEventId,
    versions[1].event.id,
  );
  assert.equal(
    clientHeads.find((record) => record.value.clientId.endsWith("0013"))?.value
      .status,
    "onboarding",
  );
});
