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
import {
  BusinessMark,
  FirstRunButton,
  FirstRunError,
  FirstRunLink,
  FirstRunSectionDivider,
  InviteCard,
} from "./firstRunControls";
import { FirstRunHead } from "./FirstRunFrame";
import { JoinPolicyNotice } from "./JoinPolicyNotice";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation";

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
    <div className="c3fr-invite-brand" data-testid="invite-brand">
      <BusinessMark dot="#c6b3f4" name={invite.businessName} size="small" />
      <span className="c3fr-invite-brand-text">
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
 * The invite link or code form. Accepts a full invite link (https or
 * colony/buzz join link) or a bare code plus the workspace address.
 */
function InviteLinkForm({
  autoFocus,
  onContinue,
  onEscape,
  submitLabel = "Continue",
}: {
  autoFocus?: boolean;
  /** Returns an error to show, or null once the invite was accepted. */
  onContinue: (target: InviteTarget) => string | null;
  onEscape?: () => void;
  submitLabel?: string;
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
    if (!autoFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

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

  return (
    <form
      aria-label="Invite link"
      className="c3fr-form"
      onKeyDown={(event) => {
        if (event.key === "Escape" && onEscape) {
          event.stopPropagation();
          onEscape();
        }
      }}
      onSubmit={submit}
      style={{ "--c3fr-gap": 14 } as React.CSSProperties}
    >
      <div className="c3fr-field-group">
        <label className="c3fr-label" htmlFor="invite-link">
          Invite link or code
        </label>
        <input
          aria-describedby={error ? "invite-link-error" : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className="c3fr-input"
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
        {error ? (
          <FirstRunError id="invite-link-error">{error}</FirstRunError>
        ) : null}
      </div>
      {needsAddress ? (
        <div className="c3fr-field-group">
          <label className="c3fr-label" htmlFor="invite-address">
            <span>
              Workspace address <small>· optional</small>
            </span>
          </label>
          <input
            autoComplete="off"
            className="c3fr-input"
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
      <FirstRunButton
        data-testid="invite-link-continue"
        fit="content"
        type="submit"
      >
        {submitLabel}
      </FirstRunButton>
    </form>
  );
}

/**
 * "Have an invite link?" step: no invite yet, so only the form. Accepts a full
 * invite link or a bare code plus the workspace address.
 */
export function InviteLinkScene({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  /** Returns an error to show, or null once the invite was accepted. */
  onContinue: (target: InviteTarget) => string | null;
}) {
  const content = (
    <div
      className="c3fr-form"
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <FirstRunHead
        lede="Paste the link your teammate sent you to join their workspace."
        title="Have an invite?"
      />
      <InviteLinkForm autoFocus onContinue={onContinue} onEscape={onBack} />
      <FirstRunButton fit="content" onClick={onBack}>
        Back
      </FirstRunButton>
    </div>
  );

  return (
    <OnboardingScenePresentation
      contentOverride={content}
      data={EMPTY_DATA}
      onNavigate={() => onBack()}
      scene="invite"
    />
  );
}

type PolicyState =
  | { status: "loading" }
  | { status: "ready"; policy: JoinPolicy | null }
  | { status: "error"; message: string };

/**
 * Confirm step (design scene #invite): which workspace, who invited you when
 * the relay says, and a single "Join" action that accepts any required terms
 * and claims the invite. A terminal failure explains why and offers a way
 * forward.
 */
export function InviteJoinScene({
  email,
  invite,
  name: _name,
  onJoined,
  onTerminalFailure,
  onDismiss,
  onUseAnotherAccount,
  onUseAnotherLink,
  onUseAnotherInvite,
  secondaryAction,
}: {
  /** Account email, when known. */
  email?: string;
  invite: FirstRunInvite & { inviter?: string };
  name?: string;
  /** Invite claimed: the caller advances into the workspace. */
  onJoined: () => void;
  /** The invite can never work; the caller drops it so no relaunch is trapped. */
  onTerminalFailure: (message: string) => void;
  /** Leave the invite alone, e.g. "Not now" for someone who already has a workspace. */
  onDismiss?: { label: string; onClick: () => void };
  onUseAnotherAccount?: () => void;
  onUseAnotherLink?: () => void;
  /** The "Have a different invite?" form on the join screen; returns an error to show. */
  onUseAnotherInvite?: (target: InviteTarget) => string | null;
  /** The way forward after a failed invite, e.g. "Create my own business instead". */
  secondaryAction: { label: string; onClick: () => void };
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
      if (described.kind === "terminal") onTerminalFailure(described.message);
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
    <div
      className="c3fr-form"
      data-testid="invite-failed"
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <InviteBrand invite={invite} />
      <FirstRunHead lede={failure.message} title="That invite didn’t work." />
      {onUseAnotherLink ? (
        <FirstRunButton
          data-testid="invite-use-another-link"
          kind="primary"
          onClick={onUseAnotherLink}
        >
          Try a different link
        </FirstRunButton>
      ) : null}
      <FirstRunButton
        data-testid="invite-create-own-business"
        kind={onUseAnotherLink ? "secondary" : "primary"}
        onClick={secondaryAction.onClick}
      >
        {secondaryAction.label}
      </FirstRunButton>
    </div>
  ) : (
    <div
      className="c3fr-form"
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <FirstRunHead
        lede="Join your team, their agents and the work already in motion."
        title="You’re invited."
      />
      <InviteCard email={email} invite={invite} />
      <form
        className="c3fr-form"
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
        style={{ "--c3fr-gap": 22 } as React.CSSProperties}
      >
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
            <FirstRunError>{policyState.message}</FirstRunError>
            <FirstRunButton
              data-testid="invite-policy-retry"
              onClick={() => setPolicyAttempt((current) => current + 1)}
            >
              Retry
            </FirstRunButton>
          </>
        ) : null}
        {policyHint ? <FirstRunError>{policyHint}</FirstRunError> : null}
        {failure && failure.kind === "retryable" ? (
          <FirstRunError>{failure.message}</FirstRunError>
        ) : null}
        <FirstRunButton
          data-testid="invite-join"
          disabled={
            pending || policyState.status !== "ready" || Boolean(consentMissing)
          }
          kind="primary"
          type="submit"
        >
          {joinLabel}
        </FirstRunButton>
      </form>
      <FirstRunLink
        className="c3fr-center-link"
        data-testid="invite-create-own-business-link"
        onClick={secondaryAction.onClick}
      >
        {secondaryAction.label}
      </FirstRunLink>
      {onUseAnotherInvite ? (
        <>
          <FirstRunSectionDivider>
            Have a different invite?
          </FirstRunSectionDivider>
          <InviteLinkForm onContinue={onUseAnotherInvite} />
        </>
      ) : null}
    </div>
  );

  const top = onUseAnotherAccount ? (
    <FirstRunLink onClick={onUseAnotherAccount}>
      Use another account
    </FirstRunLink>
  ) : onDismiss ? (
    <FirstRunLink data-testid="invite-dismiss" onClick={onDismiss.onClick}>
      {onDismiss.label}
    </FirstRunLink>
  ) : null;

  return (
    <OnboardingScenePresentation
      contentOverride={content}
      data={{
        ...EMPTY_DATA,
        scoutGuidance: undefined,
        inviteScene: {
          businessName: invite.businessName,
          inviter: invite.inviter,
        },
      }}
      scene="invite"
      topOverride={top}
    />
  );
}
