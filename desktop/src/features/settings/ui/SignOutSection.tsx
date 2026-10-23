import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import {
  getActiveDraftEntries,
  useDraftsSnapshot,
} from "@/features/messages/lib/useDrafts";
import { getAccountAuthClient } from "@/features/onboarding/accountAuthAdapter";
import { signOut, signOutKeepData } from "@/shared/api/tauriIdentity";
import { DeviceIcon, MinusIcon } from "./settingsIcons";

const accountQueryKey = ["settings-account-auth"] as const;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function listNames(names: string[]) {
  return names.join(", ");
}

/**
 * Sign-in & devices: "Sign out" ends the session on this computer and keeps
 * its data; "Sign out & remove data" first says what goes (unsent drafts and
 * the agents running here) and only then wipes the computer.
 */
export function SignOutSection() {
  const [confirming, setConfirming] = React.useState(false);
  const [isPending, setIsPending] = React.useState<"keep" | "wipe" | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const managedAgentsQuery = useManagedAgentsQuery();
  const accountQuery = useQuery({
    queryKey: accountQueryKey,
    queryFn: () => getAccountAuthClient().getAccount(),
    retry: false,
    staleTime: 60_000,
  });
  useDraftsSnapshot();
  const drafts = getActiveDraftEntries();
  const localAgentNames = (managedAgentsQuery.data ?? [])
    .filter(
      (agent) =>
        agent.backend.type === "local" &&
        agent.status === "running" &&
        isManagedAgentActive(agent),
    )
    .map((agent) => agent.name);
  const attachmentCount = drafts.reduce(
    (total, { draft }) => total + draft.pendingImeta.length,
    0,
  );
  const email = accountQuery.data?.email;

  async function run(kind: "keep" | "wipe") {
    setIsPending(kind);
    setError(null);
    try {
      if (kind === "keep") await signOutKeepData();
      else await signOut();
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Sign-out could not be completed.",
      );
      setIsPending(null);
    }
  }

  return (
    <>
      <div className="cs-card" data-testid="settings-account-security">
        <div className="cs-device-row">
          <span aria-hidden="true" className="cs-device-tile">
            <DeviceIcon size={20} />
          </span>
          <div className="cs-device-copy">
            <span className="cs-row-label">This device</span>
            <span className="cs-signed-in">
              <i aria-hidden="true" />
              {email ? `Signed in as ${email}` : "Signed in"}
            </span>
          </div>
          <button
            className="cs-button"
            data-testid="signout-keep-data"
            disabled={isPending !== null}
            onClick={() => void run("keep")}
            type="button"
          >
            {isPending === "keep" ? "Signing out" : "Sign out"}
          </button>
        </div>
        <div className="cs-device-row">
          <div className="cs-row-copy">
            <span className="cs-row-label">Sign out &amp; remove data</span>
            <span className="cs-row-help">
              Removes this device’s drafts and stops the agents running here.
              You’ll confirm what goes before anything is removed.
            </span>
          </div>
          <button
            className="cs-button"
            data-testid="signout-open-dialog-remove-data"
            data-tone="danger"
            disabled={isPending !== null}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            type="button"
          >
            Sign out &amp; remove data
          </button>
        </div>
      </div>

      {confirming ? (
        <div
          aria-labelledby="remove-device-data-title"
          className="cs-confirm"
          data-testid="signout-dialog"
          role="group"
        >
          <h3 id="remove-device-data-title">Remove this device’s data?</h3>
          <ul>
            {drafts.length > 0 ? (
              <li>
                <MinusIcon size={16} strokeWidth={2.4} />
                {plural(drafts.length, "unsent draft", "unsent drafts")}
              </li>
            ) : null}
            {attachmentCount > 0 ? (
              <li>
                <MinusIcon size={16} strokeWidth={2.4} />
                {plural(
                  attachmentCount,
                  "pending attachment",
                  "pending attachments",
                )}
              </li>
            ) : null}
            {localAgentNames.length > 0 ? (
              <li>
                <MinusIcon size={16} strokeWidth={2.4} />
                Local agents managed on this Mac: {listNames(localAgentNames)}
              </li>
            ) : null}
            {drafts.length === 0 &&
            attachmentCount === 0 &&
            localAgentNames.length === 0 ? (
              <li>
                <MinusIcon size={16} strokeWidth={2.4} />
                Nothing unsent and no local agents running. Your business and
                conversations stay available.
              </li>
            ) : null}
          </ul>
          {error ? (
            <p className="cs-notice" data-tone="bad" role="alert">
              {error}
            </p>
          ) : null}
          <div className="cs-confirm-actions">
            <button
              className="cs-danger-solid"
              data-testid="signout-confirm"
              disabled={isPending !== null}
              onClick={() => void run("wipe")}
              type="button"
            >
              {isPending === "wipe"
                ? "Signing out"
                : "Stop local agents & sign out"}
            </button>
            <button
              className="cs-button cs-button-large"
              disabled={isPending !== null}
              onClick={() => setConfirming(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="cs-notice" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
