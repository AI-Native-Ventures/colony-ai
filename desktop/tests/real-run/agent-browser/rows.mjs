/** Prepared acceptance rows. No app, server, subprocess or provider starts on import. */
export const ROWS = Object.freeze([
  {
    id: "approve",
    requires: "runtime",
    steps: [
      "Open the fixture tab as the person",
      "Approve only this managed task and fixture origin",
      "Ask the FAKE-provider agent to snapshot and send the fixture form",
      "Observe the confirmation and zero submissions before confirmation",
      "Confirm in the visible control UI",
      "Observe exactly one submission and a redacted action-log result",
    ],
  },
  {
    id: "deny",
    requires: "runtime",
    steps: [
      "Start a new approved managed task",
      "Ask the agent to send the fixture form",
      "Observe pending confirmation and zero submissions",
      "Reject through the visible control UI",
      "Observe refused tool result and zero submissions",
    ],
  },
  {
    id: "takeover",
    requires: "runtime",
    steps: [
      "Park the managed agent on a send confirmation",
      "Take over through the visible control UI",
      "Observe person control and terminated pending action",
      "Attempt the stale confirmation and agent action",
      "Observe zero submissions and no new agent authority",
    ],
  },
  {
    id: "stop",
    requires: "runtime",
    steps: [
      "Park the managed agent on a send confirmation",
      "Click Stop through the visible control UI",
      "Observe revoked grant and person control",
      "Attempt a subsequent browser action in the same agent session",
      "Observe refusal, zero submissions and no retained active action",
    ],
  },
  {
    id: "upload",
    requires: "immutable-upload-slice",
    steps: [
      "Create a synthetic file under the throwaway HOME",
      "Select it through the actual native file picker",
      "Ask the managed agent to attach it using the opaque upload id",
      "Reject once and observe no attached file",
      "Confirm a fresh attempt, replace the original synthetic file, then submit",
      "Observe the original approved byte digest at the fixture server",
      "End the grant and observe empty private payload and ownership journals",
    ],
  },
  {
    id: "download",
    requires: "confirmed-download-slice",
    steps: [
      "Seed a synthetic report.txt collision under the throwaway Downloads",
      "Reject a managed browser_download and observe zero requests and saved files",
      "Confirm two fresh link-reference attempts through the visible controls",
      "Observe identical fixture bytes in distinct saved files, preserving the collision",
      "Confirm a private redirect attempt and observe refusal before the forbidden listener",
      "Stop the grant and observe saved files survive with no private payload or ownership journals",
    ],
  },
  {
    id: "private-url-refusal",
    requires: "runtime",
    steps: [
      "Ask the managed agent to navigate to a second loopback port, RFC1918 address and file URL",
      "Exercise a fixture redirect to the forbidden loopback port",
      "Observe private_destination or scheme_denied at the production broker",
      "Observe zero requests at the forbidden fixture listener and unchanged grant scope",
    ],
  },
]);

export function preparedRows() {
  return ROWS.map(({ id, requires, steps }) => ({
    id,
    requires,
    steps: [...steps],
    status: "NOT OBSERVED",
    reason: "Prepared only. No packaged app run has occurred.",
  }));
}

/** Judge collected packaged evidence; preparing a row or a direct MCP client cannot pass. */
export function judgeRow(id, evidence = {}) {
  if (!ROWS.some((row) => row.id === id))
    throw new Error("Unknown agent browser row");
  const blocked = (reason) => ({ id, status: "BLOCKED", reason });
  const fail = (reason) => ({ id, status: "FAIL", reason });
  if (
    !evidence.packaged ||
    !/^[a-f0-9]{64}$/u.test(evidence.artifactSha256 ?? "")
  )
    return blocked("Packaged provenance was not observed.");
  if (
    !evidence.freshHome ||
    !evidence.isolatedProfile ||
    !evidence.keychainDenied
  )
    return blocked(
      "Throwaway HOME, profile and process isolation were not observed.",
    );
  if (
    !evidence.fakeProviderOnly ||
    !evidence.managedAcpSession ||
    !evidence.scopedMcpLaunchedByHarness
  )
    return blocked(
      "A managed ACP session using only the FAKE provider and production-scoped MCP was not observed.",
    );
  if (
    !evidence.flagOn ||
    !evidence.defaultFlagUnset ||
    !evidence.realControlUi ||
    !evidence.actionLogRedacted
  )
    return blocked(
      "Enabled runtime, visible person controls and redacted action log were not observed.",
    );
  if (!evidence.fixtureGranted)
    return blocked(
      "The packaged host refuses loopback agent grants. No approved fixture containment mechanism was observed.",
    );
  if (evidence.unexpectedExternalRequests || evidence.credentialExposure)
    return fail(
      "Unexpected external traffic or credential exposure was observed.",
    );
  const zero = (value) => Number.isInteger(value) && value === 0;
  if (id === "approve") {
    if (
      !evidence.confirmationVisible ||
      !evidence.personConfirmed ||
      !evidence.toolSucceeded
    )
      return fail("Approval or resulting agent action was not observed.");
    if (!zero(evidence.beforeSubmissions) || evidence.afterSubmissions !== 1)
      return fail("The form must submit once, only after the person confirms.");
  } else if (id === "deny") {
    if (
      !evidence.personRejected ||
      !evidence.toolRefused ||
      !zero(evidence.afterSubmissions)
    )
      return fail(
        "Reject must refuse the pending action with zero submissions.",
      );
  } else if (id === "takeover" || id === "stop") {
    if (
      !evidence.personControl ||
      !evidence.grantTerminated ||
      !evidence.staleActionRefused ||
      !zero(evidence.afterSubmissions) ||
      !zero(evidence.activeActions)
    )
      return fail(
        "Ended control must fence pending and subsequent actions without effects.",
      );
  } else if (id === "upload") {
    if (!evidence.immutableUploadSliceInArtifact)
      return blocked(
        "The artifact does not include the immutable upload slice from PR 280.",
      );
    if (
      !evidence.nativePickerUsed ||
      !evidence.uploadRejectedWithoutEffect ||
      !evidence.personConfirmed ||
      !evidence.originalReplacedBeforeSubmit ||
      !/^[a-f0-9]{64}$/u.test(evidence.approvedDigest ?? "") ||
      evidence.receivedDigest !== evidence.approvedDigest ||
      evidence.afterUploads !== 1 ||
      !evidence.grantTerminated ||
      !zero(evidence.privatePayloads) ||
      !zero(evidence.ownershipRecords)
    )
      return fail(
        "Approved immutable bytes, rejected upload and grant-end cleanup were not all observed.",
      );
  } else if (id === "download") {
    if (!evidence.confirmedDownloadSliceInArtifact)
      return blocked(
        "The artifact does not include the download slice from PR 282.",
      );
    if (
      !evidence.downloadRejectedWithoutEffect ||
      !evidence.personConfirmed ||
      !evidence.toolSucceeded ||
      !evidence.collisionPreserved ||
      !evidence.distinctSavedFiles ||
      !evidence.savedFilesSurviveStop ||
      !evidence.redirectRefused ||
      !evidence.grantTerminated ||
      !/^[a-f0-9]{64}$/u.test(evidence.expectedDigest ?? "") ||
      evidence.firstSavedDigest !== evidence.expectedDigest ||
      evidence.secondSavedDigest !== evidence.expectedDigest ||
      evidence.afterDownloads !== 2 ||
      evidence.afterDownloadRequests !== 2 ||
      !zero(evidence.forbiddenRequests) ||
      !zero(evidence.privatePayloads) ||
      !zero(evidence.ownershipRecords)
    )
      return fail(
        "Confirmed download bytes, rejection, collision, redirect containment and grant-end cleanup were not all observed.",
      );
  } else {
    if (
      !evidence.privateAddressRefused ||
      !evidence.redirectRefused ||
      !evidence.fileSchemeRefused ||
      !evidence.scopeUnchanged ||
      !zero(evidence.forbiddenRequests)
    )
      return fail(
        "Private navigation, redirect and file URL must fail before any forbidden request.",
      );
  }
  return {
    id,
    status: "PASS",
    reason: "All required packaged observations were collected for this row.",
  };
}
