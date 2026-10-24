import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { joinPolicyDocumentUrl, type JoinPolicy } from "@/shared/api/invites";
import "./firstRun.css";

type JoinPolicyNoticeProps = {
  ageConfirmed: boolean;
  agreementConfirmed: boolean;
  onAgeConfirmedChange: (confirmed: boolean) => void;
  onAgreementConfirmedChange: (confirmed: boolean) => void;
  policy: JoinPolicy;
  /** Relay hosting the policy documents the links below point at. */
  relayWsUrl: string;
};

/**
 * Join-policy consent block shown on every join surface.
 *
 * The Terms/Privacy links open the relay-hosted document pages
 * (`/api/join-policy/terms|privacy`) in the system browser via the OS
 * opener. They must NOT navigate or render in-app: these surfaces exist
 * before onboarding completes, where the router (required by the message
 * Markdown component) is not mounted — an in-app render tears down the
 * whole React tree.
 */
export function JoinPolicyNotice({
  ageConfirmed,
  agreementConfirmed,
  onAgeConfirmedChange,
  onAgreementConfirmedChange,
  policy,
  relayWsUrl,
}: JoinPolicyNoticeProps) {
  const ageConfirmationId = React.useId();
  const agreementConfirmationId = React.useId();
  const open = (kind: "terms" | "privacy") => (event: React.MouseEvent) => {
    event.preventDefault();
    void openUrl(joinPolicyDocumentUrl(relayWsUrl, kind));
  };

  return (
    <div className="c3fr-checks">
      {policy.ageAttestationRequired ? (
        <div className="c3fr-check">
          <input
            checked={ageConfirmed}
            id={ageConfirmationId}
            onChange={(event) =>
              onAgeConfirmedChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <label htmlFor={ageConfirmationId}>I’m 18 or older</label>
        </div>
      ) : null}

      {policy.termsMarkdown || policy.privacyMarkdown ? (
        <div className="c3fr-check">
          <input
            checked={agreementConfirmed}
            id={agreementConfirmationId}
            onChange={(event) =>
              onAgreementConfirmedChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <label htmlFor={agreementConfirmationId}>
            I agree to the{" "}
            {policy.termsMarkdown ? (
              <button
                className="c3fr-link"
                onClick={open("terms")}
                type="button"
              >
                Terms
              </button>
            ) : null}
            {policy.termsMarkdown && policy.privacyMarkdown ? " and " : null}
            {policy.privacyMarkdown ? (
              <button
                className="c3fr-link"
                onClick={open("privacy")}
                type="button"
              >
                Privacy Policy
              </button>
            ) : null}
          </label>
        </div>
      ) : null}
    </div>
  );
}
