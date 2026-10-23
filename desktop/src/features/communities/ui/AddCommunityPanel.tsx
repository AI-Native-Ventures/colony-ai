import { InviteRedeemForm } from "@/features/onboarding/ui/InviteRedeemForm";
import { CloseXIcon, LinkIcon } from "@/features/onboarding/ui/firstRunIcons";
import "@/features/onboarding/ui/firstRun.css";

import type { AddCommunityPrefillRequest } from "../addCommunityPrefill";
import { SelfServeCommunityCreateFlow } from "./SelfServeCommunityCreateFlow";

export type AddCommunityTarget = {
  relayUrl: string;
  inviteCode?: string;
  policyReceipt?: string;
};

/**
 * "Add a community": create one (claim an address) or join one (a community
 * link or invite), side by side. The same card is the in-app dialog and the
 * first-run screen.
 */
export function AddCommunityPanel({
  prefill,
  joinError,
  onClose,
  onCreated,
  onStart,
  titleId = "add-community-dialog-title",
}: {
  prefill?: AddCommunityPrefillRequest | null;
  joinError: string | null;
  onClose: () => void;
  onCreated?: () => void;
  onStart: (target: AddCommunityTarget) => void;
  titleId?: string;
}) {
  return (
    <div className="c3fr-add-card c3fr-dialog" data-testid="add-community-card">
      <div className="c3fr-add-head">
        <h1 className="c3fr-add-title" id={titleId}>
          Add a community
        </h1>
        <button
          aria-label="Close"
          className="c3fr-add-close"
          data-testid="add-community-close"
          onClick={onClose}
          type="button"
        >
          <CloseXIcon size={18} />
        </button>
      </div>
      <div className="c3fr-add-panes">
        <SelfServeCommunityCreateFlow
          onBack={onClose}
          onComplete={onCreated ?? onClose}
        />
        <section
          aria-labelledby="add-community-join-title"
          className="c3fr-pane"
          data-side="join"
        >
          <div className="c3fr-pane-head">
            <span aria-hidden="true" className="c3fr-tile">
              <LinkIcon size={20} />
            </span>
            <span className="c3fr-pane-head-text">
              <span className="c3fr-pane-title" id="add-community-join-title">
                Join an existing community
              </span>
              <span className="c3fr-pane-desc">
                Use a community URL or invite link.
              </span>
            </span>
          </div>
          <InviteRedeemForm
            error={joinError}
            initialValue={prefill?.relayUrl}
            isRedeeming={false}
            key={prefill?.requestId ?? "manual-add-community"}
            onCancel={onClose}
            onConnect={(relayUrl) => onStart({ relayUrl })}
            onRedeem={(relayUrl, inviteCode, policyReceipt) =>
              onStart({ relayUrl, inviteCode, policyReceipt })
            }
            variant="add-community"
          />
        </section>
      </div>
    </div>
  );
}
