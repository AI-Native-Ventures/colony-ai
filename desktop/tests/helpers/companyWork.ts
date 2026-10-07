import { expect, type Page } from "@playwright/test";
import { finalizeEvent } from "nostr-tools/pure";

export async function waitForCompanyWorkThreadContextRead(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__BUZZ_E2E_QUERY_CLIENT__?.getQueryState([
          "channels",
        ]) as
          | {
              dataUpdatedAt?: number;
              fetchStatus: string;
              status: string;
            }
          | undefined;
        return Boolean(
          state &&
            state.status === "success" &&
            state.fetchStatus === "idle" &&
            (state.dataUpdatedAt ?? 0) > 0,
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByText("Checking linked work", { exact: true }),
  ).toHaveCount(0);
}

/** The mock channels the dock tabs specs seed work into. */
export const MOCK_CHANNEL_IDS = {
  general: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
  random: "9dae0116-799b-5071-a0a8-fdd30a91a35d",
  engineering: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
  /** An open stream channel the default mock identity has not joined. */
  design: "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e",
} as const;

export type SeedChannelWork = {
  channelId: string;
  workItemId: string;
  title: string;
  ownerPubkey: string;
  status?:
    | "active"
    | "paused"
    | "blocked"
    | "done_unverified"
    | "done_verified"
    | "archived";
  dueAt?: string;
};

/**
 * A relay-signed company work head for one channel, shaped exactly like the
 * relay's own record so the production reader (signature, scope and schema
 * checks included) parses it.
 */
export function channelWorkHeadEvent(
  relaySecret: Uint8Array,
  work: SeedChannelWork,
) {
  return finalizeEvent(
    {
      kind: 30634,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [
        ["h", work.channelId],
        ["d", `company:work:${work.workItemId}`],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        workItemId: work.workItemId,
        title: work.title,
        status: work.status ?? "active",
        assignedPubkeys: [work.ownerPubkey],
        approverPubkeys: [],
        deliverables: [],
        requesterPubkey: work.ownerPubkey,
        doneCondition: `The work for ${work.title} is complete.`,
        // The reader rejects a due date that is not after the acceptance, so a
        // past due date needs an acceptance before it.
        ...(work.dueAt
          ? {
              acceptedAt: new Date(
                Date.parse(work.dueAt) - 86_400_000,
              ).toISOString(),
              dueAt: work.dueAt,
            }
          : {}),
        // The reader only accepts done_verified with a passing verification.
        ...(work.status === "done_verified"
          ? {
              verification: {
                verdict: "pass",
                reason: "Checked against the brief.",
                evidence: "The deliverable matches the done condition.",
                reviewerPubkey: work.ownerPubkey,
                reviewedAt: new Date().toISOString(),
                sourceActionEventId: "d".repeat(64),
              },
            }
          : {}),
        sourceActionEventId: "c".repeat(64),
      }),
    },
    relaySecret,
  );
}
