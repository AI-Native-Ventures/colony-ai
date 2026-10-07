import colonyIcon from "@/assets/colony-icon.svg";
import { claimInviteInBrowser } from "@/features/invite/invite-api";
import { colonyJoinLink } from "@/shared/lib/colony-links";
import { hasNip07Provider } from "@/shared/lib/nostr-signer";
import { relayHttpUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import * as React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { InviteInstallPanel } from "./InviteInstallPanel";
import { InviteJoinPolicyNotice } from "./InviteJoinPolicyNotice";

type JoinPolicy = {
  terms_markdown?: string;
  privacy_markdown?: string;
  age_attestation_required: boolean;
  version: string;
};

type PolicyDocument = { title: string; markdown: string };

/** Convert relay invite sentinels into user-facing recovery guidance. */
function inviteClaimErrorMessage(message: string): string {
  if (message.includes("invite_exhausted")) {
    return "This invite has reached its use limit. Ask for a new invite.";
  }
  if (message.includes("invite_expired")) {
    return "This invite has expired. Ask for a new invite.";
  }
  if (message.includes("invite_invalid")) {
    return "This invite is invalid. Check the link or ask for a new invite.";
  }
  return message;
}

/** Landing page for a community invite link (`/invite/<code>`). */
export function InvitePage({ code }: { code: string }) {
  const relay = relayWsUrl();
  const host = relay.replace(/^wss?:\/\//, "");
  const [policy, setPolicy] = React.useState<JoinPolicy | null | undefined>(
    undefined,
  );
  const [document, setDocument] = React.useState<PolicyDocument | null>(null);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [agreementConfirmed, setAgreementConfirmed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [joiningBrowser, setJoiningBrowser] = React.useState(false);
  const [browserJoinError, setBrowserJoinError] = React.useState<string | null>(
    null,
  );
  const [openAttempted, setOpenAttempted] = React.useState(false);
  // The link a visitor pastes into the app, so it is the page's own address.
  const inviteUrl = `${relayHttpUrl(relay)}/invite/${encodeURIComponent(code)}`;

  React.useEffect(() => {
    fetch("/api/join-policy")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = (await response.json()) as { policy?: JoinPolicy };
        setPolicy(config.policy ?? null);
      })
      .catch(() => setPolicy(undefined));
  }, []);

  const acceptPolicy = async (): Promise<string | undefined> => {
    if (!policy) return undefined;
    const response = await fetch("/api/invites/accept-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        policy_version: policy.version,
        age_confirmed: ageConfirmed,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as { receipt: string }).receipt;
  };

  const openInvite = async () => {
    setOpening(true);
    try {
      const receipt = await acceptPolicy();
      setOpenAttempted(true);
      window.location.href = colonyJoinLink(relay, code, receipt);
    } finally {
      setOpening(false);
    }
  };

  const joinInBrowser = async () => {
    setBrowserJoinError(null);
    setJoiningBrowser(true);
    try {
      const receipt = await acceptPolicy();
      await claimInviteInBrowser(code, receipt);
      window.location.assign("/");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not claim this invite.";
      setBrowserJoinError(inviteClaimErrorMessage(message));
    } finally {
      setJoiningBrowser(false);
    }
  };

  const browserSigningAvailable = hasNip07Provider();
  const disabled =
    policy === undefined ||
    opening ||
    joiningBrowser ||
    Boolean(policy?.age_attestation_required && !ageConfirmed) ||
    Boolean(
      policy &&
        (policy.terms_markdown || policy.privacy_markdown) &&
        !agreementConfirmed,
    );
  const hasPolicyRequirements = Boolean(
    policy &&
      (policy.age_attestation_required ||
        policy.terms_markdown ||
        policy.privacy_markdown),
  );
  const showDocument = (title: string, markdown: string) =>
    setDocument({ title, markdown });
  const primaryButtonClass = browserSigningAvailable
    ? "border border-colony-green bg-colony-card text-colony-green hover:bg-colony-green hover:text-colony-green-ink"
    : "bg-colony-green text-colony-green-ink hover:opacity-90";

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-colony-paper px-4 py-16 text-center text-colony-ink">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex w-full flex-col items-center rounded-3xl border border-colony-line bg-colony-card px-6 py-10 sm:px-12 sm:py-12">
          <img alt="Colony" className="h-16 w-16" src={colonyIcon} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            You&apos;re invited to join
          </h1>
          <p className="mt-6 break-all font-mono text-lg text-colony-muted">
            {host}
          </p>
          <p className="mt-2 text-sm text-colony-muted">
            Open this invite in the Colony desktop app.
          </p>

          <div
            className={`grid w-full max-w-md overflow-hidden transition-[grid-template-rows,margin,opacity,transform] duration-[220ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              hasPolicyRequirements
                ? "mt-9 -mb-4 grid-rows-[1fr] opacity-100 translate-y-0"
                : "m-0 grid-rows-[0fr] opacity-0 -translate-y-1"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              {policy && hasPolicyRequirements ? (
                <InviteJoinPolicyNotice
                  ageConfirmed={ageConfirmed}
                  agreementConfirmed={agreementConfirmed}
                  onAgeConfirmedChange={setAgeConfirmed}
                  onAgreementConfirmedChange={setAgreementConfirmed}
                  onShowDocument={showDocument}
                  policy={policy}
                />
              ) : null}
            </div>
          </div>

          <div className="mt-9 w-full max-w-md space-y-2">
            {browserSigningAvailable ? (
              <Button
                className="h-11 w-full rounded-full bg-colony-green text-colony-green-ink hover:opacity-90 focus-visible:ring-colony-focus disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                onClick={joinInBrowser}
              >
                {joiningBrowser ? "Joining…" : "Join in browser"}
              </Button>
            ) : null}
            {policy === null ? (
              <Button
                asChild
                className={`h-11 w-full rounded-full focus-visible:ring-colony-focus ${primaryButtonClass}`}
              >
                <a
                  href={colonyJoinLink(relay, code)}
                  onClick={() => setOpenAttempted(true)}
                >
                  Open in Colony
                </a>
              </Button>
            ) : (
              <Button
                className={`h-11 w-full rounded-full focus-visible:ring-colony-focus disabled:cursor-not-allowed disabled:opacity-40 ${primaryButtonClass}`}
                disabled={disabled}
                onClick={openInvite}
              >
                Open in Colony
              </Button>
            )}
            {openAttempted ? (
              <p className="text-sm text-colony-muted" role="status">
                Nothing opened? Install Colony below, then paste the invite
                link.
              </p>
            ) : null}
            {browserJoinError ? (
              <p className="text-sm text-red-700" role="alert">
                {browserJoinError}
              </p>
            ) : null}
          </div>
        </div>
        <InviteInstallPanel inviteUrl={inviteUrl} />
      </div>

      {document && (
        <div
          aria-label={document.title}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-colony-ink/50 p-4 text-left"
          role="dialog"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDocument(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-colony-card p-6 text-colony-ink shadow-xl sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">{document.title}</h2>
              <button
                aria-label="Close"
                className="text-2xl leading-none text-colony-muted hover:text-colony-ink"
                type="button"
                onClick={() => setDocument(null)}
              >
                ×
              </button>
            </div>
            <div className="prose prose-sm max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>
                {document.markdown}
              </Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
