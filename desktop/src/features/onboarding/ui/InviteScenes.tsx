import * as React from "react";

import { normalizeRelayUrl } from "@/features/communities/communityStorage";
import { parseInviteInput } from "@/shared/api/inviteHelpers";
import {
  acceptJoinPolicy,
  claimInvite,
  getJoinPolicy,
  type JoinPolicy,
} from "@/shared/api/invites";

import type { FirstRunInvite } from "../firstRunInvite";
import { describeInviteFailure, type InviteFailure } from "../inviteFailure";
import { JoinPolicyNotice } from "./JoinPolicyNotice";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation";
import {
  BackButton,
  InlineAlert,
  PrimaryButton,
} from "./OnboardingScenePrimitives";

const EMPTY_DATA = {
  name: "",
  email: "",
  business: "",
  website: "",
  description: "",
};

/** Business mark, name and context line shown above the invite heading. */
export function InviteBrand({
  invite,
}: {
  invite: Pick<FirstRunInvite, "businessName" | "initial">;
}) {
  return (
    <div className="invite-brand" data-testid="invite-brand">
      <span aria-hidden="true" className="business-initial">
        {invite.initial}
      </span>
      <span>
        <strong>{invite.businessName}</strong>
        <small>You’ve been invited</small>
      </span>
    </div>
  );
}

type InviteTarget = { relayUrl: string; code: string };

/** Turn a typed workspace address into a ws(s) relay URL, or null when it is not one. */
function relayFromAddress(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  const relayUrl = normalizeRelayUrl(trimmed);
  try {
    const { hostname } = new URL(relayUrl);
    return hostname.includes(".") || hostname === "localhost" ? relayUrl : null;
  } catch {
    return null;
  }
}

/**
 * "Have an invite link?" step. Accepts a full invite link (https or
 * colony/buzz join link) or a bare code plus the workspace address.
 */
export function InviteLinkScene({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  /** Returns an error to show, or null once the invite was accepted. */
  onContinue: (target: InviteTarget) => string | null;
}) {
  const [value, setValue] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const parsed = React.useMemo(() => parseInviteInput(value), [value]);
  const needsAddress = parsed !== null && !("relayWsUrl" in parsed);

  // The scene presentation focuses the heading after mount; the first field
  // takes focus right after that.
  React.useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!parsed) {
      setError(
        "That doesn’t look like an invite. Paste the whole link your teammate sent you.",
      );
      return;
    }
    let relayUrl: string;
    if ("relayWsUrl" in parsed) {
      relayUrl = parsed.relayWsUrl;
    } else {
      if (!address.trim()) {
        setError(
          "Add your workspace address too. It’s in the link your teammate sent.",
        );
        return;
      }
      const fromAddress = relayFromAddress(address);
      if (!fromAddress) {
        setError("That workspace address doesn’t look right. Check it.");
        return;
      }
      relayUrl = fromAddress;
    }
    setError(onContinue({ relayUrl, code: parsed.code }));
  };

  const content = (
    <form
      aria-label="Invite link"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onBack();
        }
      }}
      onSubmit={submit}
    >
      <h2>Have an invite?</h2>
      <p className="lede">
        Paste the link your teammate sent you to join their workspace.
      </p>
      <div className="fields">
        <div className="field">
          <label htmlFor="invite-link">Invite link or code</label>
          <input
            autoComplete="off"
            id="invite-link"
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
            placeholder="https://…/invite/…"
            ref={inputRef}
            required
            spellCheck={false}
            value={value}
          />
        </div>
        {needsAddress ? (
          <div className="field">
            <label htmlFor="invite-address">Workspace address</label>
            <input
              autoComplete="off"
              id="invite-address"
              onChange={(event) => {
                setAddress(event.currentTarget.value);
                setError(null);
              }}
              placeholder="yourteam.colony.example"
              required
              spellCheck={false}
              value={address}
            />
          </div>
        ) : null}
      </div>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <PrimaryButton testId="invite-link-continue" type="submit">
        Continue
      </PrimaryButton>
      <BackButton onClick={onBack}>Back</BackButton>
    </form>
  );

  return (
    <OnboardingScenePresentation
      contentOverride={content}
      data={EMPTY_DATA}
      scene="invite"
    />
  );
}

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: JoinPolicy | null }
  | { status: "error"; message: string };

/**
 * Confirm step (design scene #invite): who invited you, which workspace, and
 * a single "Join" action that accepts any required terms and claims the
 * invite. A terminal failure explains why and offers a way forward.
 */
export function InviteJoinScene({
  email,
  invite,
  name,
  onCreateOwnBusiness,
  onJoined,
  onTerminalFailure,
  onUseAnotherAccount,
  onUseAnotherLink,
}: {
  email: string;
  invite: FirstRunInvite;
  name: string;
  onCreateOwnBusiness: () => void;
  /** Invite claimed: the caller advances into the workspace. */
  onJoined: () => void;
  /** The invite can never work; the caller drops it so no relaunch is trapped. */
  onTerminalFailure: () => void;
  onUseAnotherAccount: () => void;
  onUseAnotherLink: () => void;
}) {
  const [policyState, setPolicyState] = React.useState<PolicyState>({
    status: "loading",
  });
  const [policyAttempt, setPolicyAttempt] = React.useState(0);
  const [receiptStale, setReceiptStale] = React.useState(false);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [agreementConfirmed, setAgreementConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<InviteFailure | null>(null);
  const [policyHint, setPolicyHint] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: policyAttempt re-runs the fetch for Retry.
  React.useEffect(() => {
    let cancelled = false;
    setPolicyState({ status: "loading" });
    getJoinPolicy(invite.relayUrl, "webview")
      .then((policy) => {
        if (!cancelled) setPolicyState({ status: "ready", policy });
      })
      .catch(() => {
        if (!cancelled) {
          setPolicyState({
            status: "error",
            message:
              "We couldn’t check this workspace’s terms. Check your connection and try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [invite.relayUrl, policyAttempt]);

  const policy = policyState.status === "ready" ? policyState.policy : null;
  const policyNeedsConsent =
    policy !== null && (!invite.policyReceipt || receiptStale);
  const needsAgreement =
    policyNeedsConsent &&
    Boolean(policy.termsMarkdown || policy.privacyMarkdown);
  const needsAge = policyNeedsConsent && policy.ageAttestationRequired;
  const consentMissing =
    (needsAgreement && !agreementConfirmed) || (needsAge && !ageConfirmed);

  const join = async () => {
    if (pending || policyState.status !== "ready") return;
    setPending(true);
    setFailure(null);
    setPolicyHint(null);
    try {
      let receipt = receiptStale ? undefined : invite.policyReceipt;
      if (policy && policyNeedsConsent) {
        receipt = await acceptJoinPolicy(
          invite.relayUrl,
          invite.code,
          policy.version,
          ageConfirmed,
        );
      }
      await claimInvite(invite.relayUrl, invite.code, receipt);
      if (alive.current) onJoined();
    } catch (error) {
      const described = describeInviteFailure(error);
      if (!alive.current) return;
      if (described.kind === "terminal") onTerminalFailure();
      if (described.kind === "policy") {
        setReceiptStale(true);
        setPolicyAttempt((current) => current + 1);
        setPolicyHint(described.message);
      }
      setFailure(described);
      setPending(false);
    }
  };

  const terminal = failure?.kind === "terminal";
  const joinLabel = pending
    ? "Joining…"
    : failure?.kind === "retryable"
      ? "Try again"
      : `Join ${invite.businessName}`;

  const content = terminal ? (
    <div data-testid="invite-failed">
      <InviteBrand invite={invite} />
      <h2>That invite didn’t work.</h2>
      <p className="lede">{failure.message}</p>
      <button
        className="primary full form-submit"
        data-testid="invite-use-another-link"
        onClick={onUseAnotherLink}
        type="button"
      >
        Try a different link
      </button>
      <button
        className="secondary full"
        data-testid="invite-create-own-business"
        onClick={onCreateOwnBusiness}
        type="button"
      >
        Create my own business instead
      </button>
    </div>
  ) : (
    <>
      <InviteBrand invite={invite} />
      <h2>You’re invited.</h2>
      <p className="lede">Join your team’s workspace on Colony.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
      >
        {name ? (
          <div className="field">
            <label htmlFor="invite-name">Your name</label>
            <input id="invite-name" readOnly value={name} />
          </div>
        ) : null}
        <div className="notice">
          You’ll join as a team member using{" "}
          <strong className="mail-address">{email}</strong>.
        </div>
        {policyState.status === "ready" && policyNeedsConsent && policy ? (
          <JoinPolicyNotice
            ageConfirmed={ageConfirmed}
            agreementConfirmed={agreementConfirmed}
            onAgeConfirmedChange={setAgeConfirmed}
            onAgreementConfirmedChange={setAgreementConfirmed}
            policy={policy}
            relayWsUrl={invite.relayUrl}
          />
        ) : null}
        {policyState.status === "error" ? (
          <>
            <InlineAlert>{policyState.message}</InlineAlert>
            <button
              className="secondary full"
              data-testid="invite-policy-retry"
              onClick={() => setPolicyAttempt((current) => current + 1)}
              type="button"
            >
              Retry
            </button>
          </>
        ) : null}
        {policyHint ? <InlineAlert>{policyHint}</InlineAlert> : null}
        {failure && failure.kind === "retryable" ? (
          <InlineAlert>{failure.message}</InlineAlert>
        ) : null}
        <PrimaryButton
          disabled={
            pending || policyState.status !== "ready" || Boolean(consentMissing)
          }
          testId="invite-join"
          type="submit"
        >
          {joinLabel}
        </PrimaryButton>
      </form>
      <BackButton onClick={onUseAnotherAccount}>Use another account</BackButton>
    </>
  );

  return (
    <OnboardingScenePresentation
      contentOverride={content}
      data={{ ...EMPTY_DATA, name, email }}
      scene="invite"
    />
  );
}
