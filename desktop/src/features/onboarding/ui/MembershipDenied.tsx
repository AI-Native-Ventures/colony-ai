import * as React from "react";

import { CommunityFrame } from "@/features/communities/ui/CommunityFrame";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { nsecToNpub } from "@/shared/lib/nostrUtils";
import { canonicalNpub, UNAVAILABLE_KEY_LABEL } from "@/shared/lib/pubkey";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import {
  FirstRunButton,
  FirstRunError,
  FirstRunLink,
} from "./firstRunControls";
import { CopyIcon, LockIcon } from "./firstRunIcons";
import { InviteRedeemForm } from "./InviteRedeemForm";

type MembershipDeniedProps = {
  /** The relay that denied membership, used as the target for bare-code invites. */
  activeRelayUrl: string;
  /** The community's name, when the caller knows it. */
  communityName?: string;
  embedded?: boolean;
  onChangeCommunity: () => void;
  onImportKey: (nsec: string) => Promise<void>;
  onRetry: () => void;
  pubkey: string;
};

export function MembershipDenied({
  activeRelayUrl,
  communityName,
  embedded = false,
  onChangeCommunity,
  onImportKey,
  onRetry,
  pubkey,
}: MembershipDeniedProps) {
  // Full canonical npub; an unencodable identity renders the neutral label
  // (never raw hex) and is never copyable.
  const identityNpub = React.useMemo(
    () => (pubkey ? canonicalNpub(pubkey) : null),
    [pubkey],
  );
  const npub =
    identityNpub ?? (pubkey ? UNAVAILABLE_KEY_LABEL : "Unknown public key");
  const [copied, setCopied] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [isImportFormOpen, setIsImportFormOpen] = React.useState(false);
  const [isImportingKey, setIsImportingKey] = React.useState(false);
  const [nsecInput, setNsecInput] = React.useState("");
  const previewNpub = React.useMemo(() => nsecToNpub(nsecInput), [nsecInput]);
  const trimmedNsec = nsecInput.trim();
  const isValidNsec = previewNpub !== null;
  const [isInviteFormOpen, setIsInviteFormOpen] = React.useState(false);
  const communityOnboarding = useCommunityOnboarding();
  const name =
    communityName?.trim() || (embedded ? "this community" : "this business");

  const handleCopy = React.useCallback(async () => {
    if (!identityNpub) return;
    try {
      await writeTextToClipboard(npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code stays on screen to copy by hand.
    }
  }, [identityNpub, npub]);

  const handleImportKey = React.useCallback(async () => {
    if (!previewNpub) {
      setImportError(
        "That doesn't look like a valid nsec. Paste an nsec1 key.",
      );
      return;
    }
    setImportError(null);
    setIsImportingKey(true);
    try {
      await onImportKey(trimmedNsec);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Failed to import key.",
      );
    } finally {
      setIsImportingKey(false);
    }
  }, [onImportKey, previewNpub, trimmedNsec]);

  const handleInviteRedeem = React.useCallback(
    (relayWsUrl: string, code: string, policyReceipt?: string) => {
      communityOnboarding.start({
        source: "membership-recovery",
        relayUrl: relayWsUrl,
        inviteCode: code,
        policyReceipt,
      });
    },
    [communityOnboarding],
  );

  const card = (
    <section
      aria-labelledby="md-title"
      className="c3fr-gate-card"
      data-testid="membership-denied"
    >
      <div className="c3fr-gate-card-head">
        <span aria-hidden="true" className="c3fr-tile" data-tone="need">
          <LockIcon size={21} strokeWidth={2.2} />
        </span>
        <h2 className="c3fr-gate-card-title" id="md-title" tabIndex={-1}>
          {embedded
            ? "You’re not in this community yet"
            : "You’re not in this business yet"}
        </h2>
      </div>
      <p className="c3fr-gate-text">
        Ask an owner or admin of {name} to add you. Share this account code with
        them.
      </p>
      <div className="c3fr-code-row">
        <label className="c3fr-sr-only" htmlFor="md-code">
          Your account code
        </label>
        <input
          className="c3fr-code-field"
          data-testid="membership-denied-account-code"
          id="md-code"
          readOnly
          value={npub}
        />
        <FirstRunButton
          aria-label={copied ? "Account code copied" : "Copy account code"}
          disabled={!identityNpub}
          onClick={() => void handleCopy()}
          size="small"
        >
          <CopyIcon size={16} />
          {copied ? "Copied" : "Copy code"}
        </FirstRunButton>
      </div>

      {isInviteFormOpen ? (
        <InviteRedeemForm
          defaultRelayUrl={activeRelayUrl}
          error={null}
          isRedeeming={false}
          onCancel={() => setIsInviteFormOpen(false)}
          onRedeem={handleInviteRedeem}
        />
      ) : isImportFormOpen ? (
        <form
          className="c3fr-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleImportKey();
          }}
          style={{ "--c3fr-gap": 12 } as React.CSSProperties}
        >
          <div className="c3fr-field-group">
            <label className="c3fr-label" htmlFor="membership-denied-nsec">
              Private key
            </label>
            <input
              autoComplete="off"
              autoCorrect="off"
              className="c3fr-input"
              data-testid="membership-denied-nsec-input"
              disabled={isImportingKey}
              id="membership-denied-nsec"
              onChange={(event) => {
                setNsecInput(event.target.value);
                setImportError(null);
              }}
              placeholder="nsec1..."
              spellCheck={false}
              type="password"
              value={nsecInput}
            />
          </div>
          {previewNpub ? (
            <p
              className="c3fr-ok-line"
              data-testid="membership-denied-npub-preview"
            >
              This is the account you’re adding: {previewNpub}
            </p>
          ) : null}
          {importError ? <FirstRunError>{importError}</FirstRunError> : null}
          <div className="c3fr-gate-actions">
            <FirstRunButton
              data-testid="membership-denied-import-key"
              disabled={!isValidNsec || isImportingKey}
              kind="primary"
              size="small"
              type="submit"
            >
              {isImportingKey ? "Importing…" : "Import key"}
            </FirstRunButton>
            <FirstRunButton
              disabled={isImportingKey}
              onClick={() => {
                setImportError(null);
                setIsImportFormOpen(false);
                setNsecInput("");
              }}
              size="small"
            >
              Back
            </FirstRunButton>
          </div>
        </form>
      ) : (
        <>
          <div className="c3fr-gate-actions">
            <FirstRunButton kind="primary" onClick={onRetry} size="small">
              Try again
            </FirstRunButton>
            <FirstRunButton onClick={onChangeCommunity} size="small">
              {embedded ? "Change community" : "Change business"}
            </FirstRunButton>
          </div>
          <div className="c3fr-gate-links">
            <FirstRunLink
              data-testid="membership-denied-redeem-invite"
              onClick={() => setIsInviteFormOpen(true)}
            >
              Have an invite?
            </FirstRunLink>
            <FirstRunLink
              data-testid="membership-denied-change-key"
              onClick={() => {
                setImportError(null);
                setIsImportFormOpen(true);
              }}
            >
              Use a different account
            </FirstRunLink>
          </div>
        </>
      )}
    </section>
  );

  if (embedded) return card;
  return (
    <CommunityFrame
      body={`Nothing in ${name} is lost while you wait to be added.`}
      heading="Your work is safe. We just can’t reach it right now."
      testId="membership-denied-screen"
      variant="failed"
    >
      <div className="c3fr-brand-column">{card}</div>
    </CommunityFrame>
  );
}
