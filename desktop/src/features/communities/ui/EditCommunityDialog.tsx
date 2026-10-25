import * as React from "react";

import { CommunityIconSettingsCard } from "@/features/communities/ui/CommunityIconSettingsCard";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import type { Community } from "@/features/communities/types";
import {
  expandTilde,
  normalizeRelayUrl,
} from "@/features/communities/communityStorage";
import { validateReposDir } from "@/shared/api/tauri";
import { CloseXIcon } from "@/features/onboarding/ui/firstRunIcons";
import "@/features/onboarding/ui/firstRun.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

type EditCommunityDialogProps = {
  community: Community | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    id: string,
    updates: Partial<
      Pick<Community, "name" | "relayUrl" | "token" | "reposDir">
    >,
  ) => void;
  showIconEditor?: boolean;
};

export function EditCommunityDialog({
  community,
  open,
  onOpenChange,
  onSave,
  showIconEditor = false,
}: EditCommunityDialogProps) {
  const [name, setName] = React.useState("");
  const [relayUrl, setRelayUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [reposDir, setReposDir] = React.useState("");
  const [reposDirError, setReposDirError] = React.useState<string | null>(null);
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const activeRole = membershipQuery.data?.membership?.role;
  const canEditIcon =
    showIconEditor &&
    (membershipQuery.data?.membershipRequired === false ||
      activeRole === "owner" ||
      activeRole === "admin");

  // Sync form state when the dialog opens with a community
  React.useEffect(() => {
    if (community && open) {
      setName(community.name);
      setRelayUrl(community.relayUrl);
      setToken(community.token ?? "");
      setReposDir(community.reposDir ?? "");
      setReposDirError(null);
    }
  }, [community, open]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!community || !relayUrl.trim()) {
        return;
      }

      const updates: Partial<
        Pick<Community, "name" | "relayUrl" | "token" | "reposDir">
      > = {};

      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== community.name) {
        updates.name = trimmedName;
      }

      const normalizedUrl = normalizeRelayUrl(relayUrl.trim());
      if (normalizedUrl !== community.relayUrl) {
        updates.relayUrl = normalizedUrl;
      }

      const trimmedToken = token.trim() || undefined;
      if (trimmedToken !== community.token) {
        updates.token = trimmedToken;
      }

      // Expand `~` to an absolute path before save — the backend rejects
      // tilde paths. An empty field clears the override (REPOS reverts to a
      // real dir). Validate the expanded value (the bytes the backend
      // canonicalizes) before save so a bad path is caught here instead of
      // bricking a later boot. Only emit when the resolved value actually
      // changed so a no-op edit doesn't trigger a backend re-apply.
      const expandedReposDir = await expandTilde(reposDir);
      if (expandedReposDir !== community.reposDir) {
        try {
          await validateReposDir(expandedReposDir ?? "");
        } catch (error) {
          setReposDirError(String(error));
          return;
        }
        updates.reposDir = expandedReposDir;
      }

      if (Object.keys(updates).length > 0) {
        onSave(community.id, updates);
      }

      handleClose();
    },
    [community, name, relayUrl, token, reposDir, onSave, handleClose],
  );

  if (!community) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3fr-dialog c3fr-edit max-w-[26.375rem] gap-0 p-0"
        showCloseButton={false}
        surface="none"
      >
        <form className="c3fr-edit-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="c3fr-edit-head">
            <div className="c3fr-edit-head-text">
              <DialogTitle className="c3fr-edit-title">
                Edit Community
              </DialogTitle>
              <DialogDescription className="c3fr-edit-desc">
                Update this business name or connection address.
              </DialogDescription>
            </div>
            <button
              aria-label="Close"
              className="c3fr-edit-close"
              onClick={handleClose}
              type="button"
            >
              <CloseXIcon size={18} />
            </button>
          </div>
          {canEditIcon ? (
            <div className="c3fr-edit-icon">
              <div className="c3fr-edit-icon-text">
                <span className="c3fr-edit-icon-title">Community icon</span>
                <span className="c3fr-edit-icon-desc">
                  Shown in the community rail and switcher.
                </span>
              </div>
              <CommunityIconSettingsCard compact />
            </div>
          ) : null}
          <div className="c3fr-edit-field">
            <label htmlFor="edit-ws-name">Name</label>
            <input
              autoFocus
              id="edit-ws-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="My Community"
              type="text"
              value={name}
            />
          </div>
          <div className="c3fr-edit-field">
            <label htmlFor="edit-ws-relay-url">Connection address</label>
            <input
              id="edit-ws-relay-url"
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="wss://relay.example.com"
              spellCheck={false}
              type="text"
              value={relayUrl}
            />
          </div>
          <div className="c3fr-edit-field">
            <label htmlFor="edit-ws-token">
              API Token <small>(optional)</small>
            </label>
            <input
              autoComplete="off"
              id="edit-ws-token"
              onChange={(e) => setToken(e.target.value)}
              placeholder="buzz_..."
              type="password"
              value={token}
            />
          </div>
          <div className="c3fr-edit-field">
            <label htmlFor="edit-ws-repos-dir">
              Repos Directory <small>(optional)</small>
            </label>
            <input
              aria-describedby="edit-ws-repos-help"
              id="edit-ws-repos-dir"
              onChange={(e) => {
                setReposDir(e.target.value);
                setReposDirError(null);
              }}
              placeholder="~/Development"
              spellCheck={false}
              type="text"
              value={reposDir}
            />
            {reposDirError ? (
              <p className="c3fr-edit-error">{reposDirError}</p>
            ) : null}
            <p className="c3fr-edit-help" id="edit-ws-repos-help">
              Point the agent’s <code>REPOS</code> directory at an existing
              folder so agents work in your local checkouts. Leave blank to use
              the default location.
            </p>
          </div>
          <div className="c3fr-edit-actions">
            <button
              className="c3fr-edit-cancel"
              onClick={handleClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3fr-edit-save"
              disabled={!name.trim() || !relayUrl.trim()}
              type="submit"
            >
              Save Changes
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
