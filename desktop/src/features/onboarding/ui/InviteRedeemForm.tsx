import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  inviteErrorMessage,
  parseInviteInput,
  type ParsedInvite,
} from "@/shared/api/inviteHelpers";
import {
  acceptJoinPolicy,
  getJoinPolicy,
  isJoinPolicyDiscoveryCandidate,
  type JoinPolicy,
} from "@/shared/api/invites";
import { normalizeRelayUrl } from "@/features/communities/relayProbe";
import { cn } from "@/shared/lib/cn";
import { FirstRunButton, FirstRunError } from "./firstRunControls";
import { JoinPolicyNotice } from "./JoinPolicyNotice";
import "./firstRun.css";

const POLICY_DISCOVERY_DELAY_MS = 250;
const POLICY_REVEAL_EASE = [0.23, 1, 0.32, 1] as const;

function hasInviteRelay(
  invite: ParsedInvite,
): invite is Extract<ParsedInvite, { relayWsUrl: string }> {
  return "relayWsUrl" in invite;
}

type InviteRedeemFormProps = {
  /**
   * Pre-fill and expose a relay URL field for bare-code inputs.
   * On MembershipDenied this is the active relay; on WelcomeSetup it is the
   * configured default relay.  Omit to silently reject bare-code inputs
   * (the form stays invalid until a full invite URL is entered).
   */
  defaultRelayUrl?: string;
  error: string | null;
  initialValue?: string;
  isRedeeming: boolean;
  onCancel: () => void;
  onConnect?: (relayWsUrl: string) => void;
  onRedeem: (relayWsUrl: string, code: string, policyReceipt?: string) => void;
  placeholder?: string;
  variant?:
    | "add-community"
    | "add-workspace"
    | "default"
    | "onboarding-spotlight";
};

export function InviteRedeemForm({
  defaultRelayUrl,
  error,
  initialValue = "",
  isRedeeming,
  onCancel,
  onConnect,
  onRedeem,
  placeholder,
  variant = "default",
}: InviteRedeemFormProps) {
  const formId = React.useId();
  const [inviteInput, setInviteInput] = React.useState(initialValue);
  const [bareCodeRelayUrl, setBareCodeRelayUrl] = React.useState(
    defaultRelayUrl ?? "",
  );
  const [joinPolicy, setJoinPolicy] = React.useState<JoinPolicy | null>(null);
  const [policyTarget, setPolicyTarget] = React.useState<{
    relayWsUrl: string;
    code?: string;
  } | null>(null);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [agreementConfirmed, setAgreementConfirmed] = React.useState(false);
  const [policyError, setPolicyError] = React.useState<string | null>(null);
  const [isLoadingPolicy, setIsLoadingPolicy] = React.useState(false);
  const shouldReduceMotion = useReducedMotion();
  const busy = isRedeeming || isLoadingPolicy;

  const parsed = React.useMemo(
    () => parseInviteInput(inviteInput),
    [inviteInput],
  );
  const normalizedRelayUrl = React.useMemo(
    () =>
      onConnect &&
      (!parsed ||
        ((variant === "add-community" || variant === "add-workspace") &&
          !hasInviteRelay(parsed)))
        ? normalizeRelayUrl(inviteInput)
        : null,
    [inviteInput, onConnect, parsed, variant],
  );
  const parsedInvite: ParsedInvite | null = normalizedRelayUrl ? null : parsed;
  const isBareCode = parsedInvite !== null && !hasInviteRelay(parsedInvite);
  const needsRelayField = isBareCode && defaultRelayUrl !== undefined;

  React.useEffect(() => {
    const relayWsUrl = normalizedRelayUrl
      ? normalizedRelayUrl
      : parsedInvite && hasInviteRelay(parsedInvite)
        ? parsedInvite.relayWsUrl
        : parsedInvite
          ? bareCodeRelayUrl.trim()
          : "";
    if (!relayWsUrl || !isJoinPolicyDiscoveryCandidate(relayWsUrl)) return;

    const code = parsedInvite?.code;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void getJoinPolicy(relayWsUrl, code ? "webview" : "native")
        .then((policy) => {
          if (cancelled || !policy) return;
          setJoinPolicy(policy);
          setPolicyTarget({ relayWsUrl, code });
          setAgeConfirmed(false);
          setAgreementConfirmed(false);
          setPolicyError(null);
        })
        .catch(() => {
          // Background discovery is best-effort. A deliberate submit retries
          // the request and surfaces any relay error to the user.
        });
    }, POLICY_DISCOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bareCodeRelayUrl, normalizedRelayUrl, parsedInvite]);

  const canSubmit =
    (parsedInvite !== null &&
      ("relayWsUrl" in parsedInvite ||
        (isBareCode && bareCodeRelayUrl.trim().length > 0))) ||
    normalizedRelayUrl !== null;
  const isOnboardingSpotlight = variant === "onboarding-spotlight";
  const isAddCommunity =
    variant === "add-community" || variant === "add-workspace";
  const isAddWorkspace = variant === "add-workspace";
  const showInvalidInviteTip =
    isOnboardingSpotlight && inviteInput.trim().length > 0 && !canSubmit;

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (normalizedRelayUrl) {
        setPolicyError(null);
        setIsLoadingPolicy(true);
        try {
          const policy = await getJoinPolicy(normalizedRelayUrl, "native");
          if (!policy) {
            onConnect?.(normalizedRelayUrl);
            return;
          }

          if (
            !joinPolicy ||
            joinPolicy.version !== policy.version ||
            policyTarget?.relayWsUrl !== normalizedRelayUrl ||
            policyTarget.code !== undefined
          ) {
            setJoinPolicy(policy);
            setPolicyTarget({ relayWsUrl: normalizedRelayUrl });
            setAgeConfirmed(false);
            setAgreementConfirmed(false);
            return;
          }

          if (policy.ageAttestationRequired && !ageConfirmed) {
            setPolicyError("Confirm that you are at least 18 years old.");
            return;
          }
          if (
            (policy.termsMarkdown || policy.privacyMarkdown) &&
            !agreementConfirmed
          ) {
            setPolicyError("Agree to the Terms of Service and Privacy Policy.");
            return;
          }

          onConnect?.(normalizedRelayUrl);
        } catch (policyFetchError) {
          setPolicyError(inviteErrorMessage(policyFetchError));
        } finally {
          setIsLoadingPolicy(false);
        }
        return;
      }
      if (!parsedInvite) return;

      const relayWsUrl = hasInviteRelay(parsedInvite)
        ? parsedInvite.relayWsUrl
        : bareCodeRelayUrl.trim();
      if (!relayWsUrl) return;

      setPolicyError(null);
      setIsLoadingPolicy(true);
      try {
        const policy = await getJoinPolicy(relayWsUrl, "webview");
        if (!policy) {
          onRedeem(relayWsUrl, parsedInvite.code);
          return;
        }

        if (
          !joinPolicy ||
          joinPolicy.version !== policy.version ||
          policyTarget?.relayWsUrl !== relayWsUrl ||
          policyTarget.code !== parsedInvite.code
        ) {
          setJoinPolicy(policy);
          setPolicyTarget({ relayWsUrl, code: parsedInvite.code });
          setAgeConfirmed(false);
          setAgreementConfirmed(false);
          return;
        }

        if (policy.ageAttestationRequired && !ageConfirmed) {
          setPolicyError("Confirm that you are at least 18 years old.");
          return;
        }
        if (
          (policy.termsMarkdown || policy.privacyMarkdown) &&
          !agreementConfirmed
        ) {
          setPolicyError("Agree to the Terms of Service and Privacy Policy.");
          return;
        }

        const receipt = await acceptJoinPolicy(
          relayWsUrl,
          parsedInvite.code,
          policy.version,
          ageConfirmed,
        );
        onRedeem(relayWsUrl, parsedInvite.code, receipt);
      } catch (policyFetchError) {
        setPolicyError(inviteErrorMessage(policyFetchError));
      } finally {
        setIsLoadingPolicy(false);
      }
    },
    [
      ageConfirmed,
      agreementConfirmed,
      bareCodeRelayUrl,
      joinPolicy,
      normalizedRelayUrl,
      onConnect,
      onRedeem,
      parsedInvite,
      policyTarget,
    ],
  );

  const handleInviteInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setInviteInput(event.target.value);
    setJoinPolicy(null);
    setPolicyTarget(null);
    setAgeConfirmed(false);
    setAgreementConfirmed(false);
    setPolicyError(null);
  };

  const handleRelayInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setBareCodeRelayUrl(event.target.value);
    setJoinPolicy(null);
    setPolicyTarget(null);
    setAgeConfirmed(false);
    setAgreementConfirmed(false);
    setPolicyError(null);
  };

  const submitDisabled =
    !canSubmit ||
    isRedeeming ||
    isLoadingPolicy ||
    Boolean(joinPolicy?.ageAttestationRequired && !ageConfirmed) ||
    Boolean(
      joinPolicy &&
        (joinPolicy.termsMarkdown || joinPolicy.privacyMarkdown) &&
        !agreementConfirmed,
    );
  const submitLabel = busy
    ? isRedeeming
      ? "Redeeming invite…"
      : "Checking…"
    : isOnboardingSpotlight
      ? "Continue"
      : isAddWorkspace
        ? joinPolicy
          ? "Accept and join workspace"
          : "Join workspace"
        : isAddCommunity
          ? joinPolicy
            ? "Accept and join workspace"
            : "Join workspace"
          : joinPolicy
            ? "Accept and redeem invite"
            : "Redeem invite";
  const inputLabel = isOnboardingSpotlight
    ? "Or paste your invite link or community link"
    : isAddWorkspace
      ? "Workspace URL or invite link"
      : isAddCommunity
        ? "Community URL or invite link"
        : "Invite link or code";
  const inputPlaceholder = isOnboardingSpotlight
    ? (placeholder ?? "https://")
    : isAddCommunity
      ? "https://"
      : "https://relay.example.com/invite/abc123 or paste a code";

  const input = (
    <input
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect="off"
      className="c3fr-input"
      data-testid="invite-redeem-input"
      disabled={isRedeeming}
      id="invite-input"
      onChange={handleInviteInputChange}
      placeholder={inputPlaceholder}
      spellCheck={false}
      type="text"
      value={inviteInput}
    />
  );

  return (
    <form
      className="c3fr-form c3fr-redeem"
      data-variant={variant}
      id={formId}
      onSubmit={handleSubmit}
      style={
        { "--c3fr-gap": isOnboardingSpotlight ? 12 : 16 } as React.CSSProperties
      }
    >
      <div className="c3fr-field-group">
        <label className="c3fr-label" htmlFor="invite-input">
          {inputLabel}
        </label>
        {isOnboardingSpotlight ? (
          <div className="c3fr-row">
            {input}
            <FirstRunButton
              className="c3fr-inline-button"
              data-testid="invite-redeem-submit"
              disabled={submitDisabled}
              form={formId}
              type="submit"
            >
              {submitLabel}
            </FirstRunButton>
          </div>
        ) : (
          input
        )}
      </div>

      {isOnboardingSpotlight ? (
        <p
          aria-hidden={!showInvalidInviteTip}
          aria-live="polite"
          className={cn("c3fr-note", !showInvalidInviteTip && "c3fr-hidden")}
          data-testid="invalid-invite-tip"
        >
          Please enter a valid invite link or community URL
        </p>
      ) : null}

      {needsRelayField ? (
        <div className="c3fr-field-group">
          <label className="c3fr-label" htmlFor="invite-relay-url">
            Relay URL
          </label>
          <input
            className="c3fr-input"
            disabled={isRedeeming}
            id="invite-relay-url"
            onChange={handleRelayInputChange}
            placeholder="wss://relay.example.com"
            type="text"
            value={bareCodeRelayUrl}
          />
        </div>
      ) : null}

      {policyError ? <FirstRunError>{policyError}</FirstRunError> : null}

      {error ? <FirstRunError>{error}</FirstRunError> : null}

      <AnimatePresence initial={false}>
        {joinPolicy && policyTarget ? (
          <motion.div
            animate={{
              height: "auto",
              marginTop: 0,
              opacity: 1,
              transform: "translateY(0rem)",
            }}
            className="c3fr-policy-reveal"
            exit={
              shouldReduceMotion
                ? { height: 0, marginTop: "-0.75rem", opacity: 0 }
                : {
                    height: 0,
                    marginTop: "-0.75rem",
                    opacity: 0,
                    transform: "translateY(-0.25rem)",
                  }
            }
            initial={
              shouldReduceMotion
                ? false
                : {
                    height: 0,
                    marginTop: "-0.75rem",
                    opacity: 0,
                    transform: "translateY(-0.25rem)",
                  }
            }
            key={`${policyTarget.relayWsUrl}:${joinPolicy.version}`}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.22, ease: POLICY_REVEAL_EASE }
            }
          >
            <JoinPolicyNotice
              ageConfirmed={ageConfirmed}
              agreementConfirmed={agreementConfirmed}
              onAgeConfirmedChange={(confirmed) => {
                setAgeConfirmed(confirmed);
                setPolicyError(null);
              }}
              onAgreementConfirmedChange={(confirmed) => {
                setAgreementConfirmed(confirmed);
                setPolicyError(null);
              }}
              policy={joinPolicy}
              relayWsUrl={policyTarget.relayWsUrl}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {isOnboardingSpotlight ? null : isAddCommunity ? (
        <div className="c3fr-redeem-actions">
          {isAddWorkspace ? (
            <FirstRunButton disabled={isRedeeming} onClick={onCancel}>
              Cancel
            </FirstRunButton>
          ) : null}
          <button
            className="c3fr-accent-button"
            data-testid="invite-redeem-submit"
            disabled={submitDisabled}
            form={formId}
            type="submit"
          >
            {submitLabel}
          </button>
        </div>
      ) : (
        <>
          <FirstRunButton
            data-testid="invite-redeem-submit"
            disabled={submitDisabled}
            form={formId}
            kind="primary"
            type="submit"
          >
            {submitLabel}
          </FirstRunButton>
          <FirstRunButton disabled={isRedeeming} onClick={onCancel}>
            Cancel
          </FirstRunButton>
        </>
      )}
    </form>
  );
}
