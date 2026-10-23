import * as React from "react";

import { useIdentityQuery } from "@/shared/api/hooks";
import { signOut } from "@/shared/api/tauriIdentity";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { pubkeyToNpub } from "@/shared/lib/nostrUtils";
import { isTechnicalRelayError } from "@/shared/lib/relayError";
import {
  FirstRunButton,
  FirstRunLink,
} from "@/features/onboarding/ui/firstRunControls";
import {
  CopyIcon,
  LockIcon,
  WifiOffIcon,
} from "@/features/onboarding/ui/firstRunIcons";

import { describeCommunityApplyError } from "../lib/communityApplyError";
import { CommunityFrame } from "./CommunityFrame";
import {
  RemoveCommunityControl,
  SwitchCommunityList,
  useCommunityEscape,
} from "./CommunityEscapeActions";

type CommunityApplyErrorScreenProps = {
  error: string;
  onEditCommunity: () => void;
  /** Points the router at the target community before the app leaves this one. */
  onPrepareLanding?: (communityId: string) => void;
  onRetry: () => void;
};

function hostOf(relayUrl: string | undefined): string | null {
  if (!relayUrl) return null;
  try {
    return new URL(relayUrl.replace(/^ws/i, "http")).host;
  } catch {
    return null;
  }
}

export function CommunityApplyErrorScreen({
  error,
  onEditCommunity,
  onPrepareLanding,
  onRetry,
}: CommunityApplyErrorScreenProps) {
  const exit = useCommunityEscape({ onPrepareLanding });
  const identity = useIdentityQuery();
  const [copied, setCopied] = React.useState(false);
  const copy = describeCommunityApplyError({
    communityName: exit.failing?.name ?? null,
    error,
    hasOtherCommunities: exit.others.length > 0,
  });
  const firstSwitchRef = React.useRef<HTMLButtonElement>(null);
  const retryRef = React.useRef<HTMLButtonElement>(null);
  const name = exit.failing?.name?.trim() || "this community";
  const host = hostOf(exit.failing?.relayUrl);
  const npub = identity.data?.pubkey ? pubkeyToNpub(identity.data.pubkey) : "";
  const details = copy.isMembershipError ? copy.detail : error;

  // The first action takes focus so a keyboard user can act without hunting.
  React.useEffect(() => {
    (firstSwitchRef.current ?? retryRef.current)?.focus();
  }, []);

  const unreachable =
    !copy.isMembershipError && isTechnicalRelayError(error) && host !== null;

  return (
    <CommunityFrame
      body={`Nothing in ${name} is lost while the connection is down.`}
      heading="Your work is safe. We just can’t reach it right now."
      testId="community-apply-error"
      variant="failed"
    >
      <div
        className="c3fr-brand-column"
        style={{ "--c3fr-gap": 20 } as React.CSSProperties}
      >
        {copy.isMembershipError ? (
          <section
            aria-labelledby="md-title"
            className="c3fr-gate-card"
            data-testid="community-membership-denied"
          >
            <div className="c3fr-gate-card-head">
              <span aria-hidden="true" className="c3fr-tile" data-tone="need">
                <LockIcon size={21} strokeWidth={2.2} />
              </span>
              <h1 className="c3fr-gate-card-title" id="md-title" tabIndex={-1}>
                You’re not in this community yet
              </h1>
            </div>
            <p
              className="c3fr-gate-text"
              data-testid="community-apply-error-message"
            >
              Ask an owner or admin of {name} to add you. Share this account
              code with them.
            </p>
            <div className="c3fr-code-row">
              <label className="c3fr-sr-only" htmlFor="md-code">
                Your account code
              </label>
              <input
                className="c3fr-code-field"
                data-testid="community-account-code"
                id="md-code"
                readOnly
                value={npub || "Loading…"}
              />
              <FirstRunButton
                disabled={!npub}
                onClick={() => {
                  void writeTextToClipboard(npub).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  });
                }}
                size="small"
              >
                <CopyIcon size={16} />
                {copied ? "Copied" : "Copy code"}
              </FirstRunButton>
            </div>
            <FirstRunLink
              data-testid="community-use-different-account"
              onClick={() => {
                const confirmed = window.confirm(
                  "Sign out of Colony on this computer? You can sign in again with another account.",
                );
                if (confirmed) void signOut().catch(() => undefined);
              }}
            >
              Use a different account
            </FirstRunLink>
            {details ? (
              <p
                className="c3fr-note"
                data-testid="community-apply-error-details"
              >
                {details}
              </p>
            ) : null}
          </section>
        ) : (
          <section
            aria-labelledby="cf-title"
            className="c3fr-gate-card"
            data-size="large"
          >
            <span
              aria-hidden="true"
              className="c3fr-tile"
              data-size="large"
              data-tone="bad"
            >
              <WifiOffIcon size={24} />
            </span>
            <div className="c3fr-gate-heading">
              <h1 className="c3fr-gate-title" id="cf-title" tabIndex={-1}>
                Community connection failed
              </h1>
              <p
                className="c3fr-gate-lede"
                data-testid="community-apply-error-message"
              >
                {unreachable ? (
                  <>
                    Colony couldn’t reach {name} at <strong>{host}</strong>.
                    Check your internet connection, then try again.
                  </>
                ) : (
                  copy.message
                )}
              </p>
            </div>
            {details ? (
              <details className="c3fr-gate-details" open>
                <summary>Technical details</summary>
                <pre data-testid="community-apply-error-details">{details}</pre>
              </details>
            ) : null}
          </section>
        )}
        {exit.leaving ? (
          <p
            className="c3fr-note"
            data-testid="community-apply-error-leaving"
            role="status"
          >
            {exit.leaving === "switching"
              ? "Switching community…"
              : "Removing community…"}
          </p>
        ) : (
          <div className="c3fr-gate-actions">
            <SwitchCommunityList
              exit={exit}
              firstActionRef={firstSwitchRef}
              primary={copy.isMembershipError}
            />
            <FirstRunButton
              className="c3fr-gate-button"
              data-testid="community-apply-error-retry"
              kind={
                copy.isMembershipError && exit.others.length > 0
                  ? "secondary"
                  : "primary"
              }
              onClick={onRetry}
              ref={retryRef}
            >
              Retry
            </FirstRunButton>
            {exit.failing ? (
              <FirstRunButton
                className="c3fr-gate-button"
                data-testid="community-apply-error-edit"
                onClick={onEditCommunity}
              >
                Edit this community
                <span className="c3fr-sr-only"> ({exit.failing.name})</span>
              </FirstRunButton>
            ) : null}
            <RemoveCommunityControl exit={exit} />
          </div>
        )}
      </div>
    </CommunityFrame>
  );
}
