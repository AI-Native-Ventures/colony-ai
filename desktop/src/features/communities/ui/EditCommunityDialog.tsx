import * as React from "react";
import { ChevronDown, Copy, Folder } from "lucide-react";

import { CommunityIconSettingsCard } from "@/features/communities/ui/CommunityIconSettingsCard";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import type { Community } from "@/features/communities/types";
import {
  expandTilde,
  normalizeRelayUrl,
} from "@/features/communities/communityStorage";
import { pickWorkspaceReposDir, validateReposDir } from "@/shared/api/tauri";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
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
      setAdvancedOpen(false);
    }
  }, [community, open]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleChooseReposDir = React.useCallback(async () => {
    try {
      const selected = await pickWorkspaceReposDir();
      if (selected) {
        setReposDir(selected);
        setReposDirError(null);
      }
    } catch (error) {
      setReposDirError(
        error instanceof Error
          ? error.message
          : "Could not open the folder picker.",
      );
    }
  }, []);

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
        className="c3fr-dialog c3fr-edit max-h-[90vh] max-w-[37.5rem] gap-0 overflow-y-auto p-0"
        showCloseButton={false}
        surface="none"
      >
        <form className="c3fr-edit-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="c3fr-edit-head">
            <div className="c3fr-edit-head-text">
              <DialogTitle className="c3fr-edit-title">
                Workspace settings
              </DialogTitle>
              <DialogDescription className="c3fr-edit-desc">
                Your workspace name is saved on this device. The icon is shared
                with members through the relay.
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
                <span className="c3fr-edit-icon-title">Workspace icon</span>
                <span className="c3fr-edit-icon-desc">
                  Shown in the sidebar, workspace menu, and rail.
                </span>
              </div>
              <CommunityIconSettingsCard compact />
            </div>
          ) : null}
          <div className="c3fr-edit-field">
            <label htmlFor="edit-ws-name">Workspace name</label>
            <input
              autoFocus
              id="edit-ws-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="My workspace"
              type="text"
              value={name}
            />
          </div>
          <section
            className="mt-5 rounded-2xl border border-border bg-muted/30 p-4"
            data-testid="workspace-settings-advanced"
          >
            <button
              aria-controls="workspace-settings-advanced-fields"
              aria-expanded={advancedOpen}
              className="flex min-h-8 w-full items-center text-left text-sm font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="workspace-settings-advanced-toggle"
              onClick={() => setAdvancedOpen((open) => !open)}
              type="button"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span>Advanced</span>
                {!advancedOpen ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    Connection address, API token, repos folder
                  </span>
                ) : null}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`ml-auto h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen ? (
              <div
                className="mt-4 flex flex-col gap-4"
                data-testid="workspace-settings-advanced-fields"
                id="workspace-settings-advanced-fields"
              >
                <div className="c3fr-edit-field">
                  <label htmlFor="edit-ws-relay-url">Connection address</label>
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1"
                      id="edit-ws-relay-url"
                      onChange={(e) => setRelayUrl(e.target.value)}
                      placeholder="wss://relay.example.com"
                      spellCheck={false}
                      type="text"
                      value={relayUrl}
                    />
                    <button
                      aria-label="Copy connection address"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-input bg-background"
                      data-testid="workspace-copy-address"
                      onClick={() => {
                        copyTextToClipboard(
                          relayUrl,
                          "Connection address copied.",
                        );
                      }}
                      type="button"
                    >
                      <Copy aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="c3fr-edit-help">
                    The relay address this workspace connects to. Change it only
                    if you were given a different connection address.
                  </p>
                </div>
                <div className="c3fr-edit-field">
                  <label htmlFor="edit-ws-token">
                    API token <small>(optional)</small>
                  </label>
                  <input
                    autoComplete="off"
                    id="edit-ws-token"
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste a token"
                    type="password"
                    value={token}
                  />
                  <p className="c3fr-edit-help">
                    Used only when this relay requires a token to connect.
                  </p>
                </div>
                <div className="c3fr-edit-field">
                  <label htmlFor="edit-ws-repos-dir">Repos folder</label>
                  <div className="flex gap-2">
                    <input
                      aria-describedby="edit-ws-repos-help"
                      className="min-w-0 flex-1"
                      id="edit-ws-repos-dir"
                      onChange={(e) => {
                        setReposDir(e.target.value);
                        setReposDirError(null);
                      }}
                      placeholder="Choose a folder on this device"
                      spellCheck={false}
                      type="text"
                      value={reposDir}
                    />
                    <button
                      aria-label="Choose a Repos folder"
                      className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm font-semibold"
                      data-testid="workspace-repos-folder-choose"
                      onClick={() => void handleChooseReposDir()}
                      type="button"
                    >
                      <Folder aria-hidden="true" className="h-4 w-4" />
                      Choose
                    </button>
                  </div>
                  {reposDirError ? (
                    <p className="c3fr-edit-error" role="alert">
                      {reposDirError}
                    </p>
                  ) : null}
                  <p className="c3fr-edit-help" id="edit-ws-repos-help">
                    Sets the local REPOS folder for agent checkouts and project
                    clones. Leave empty to use the default folder.
                  </p>
                </div>
              </div>
            ) : null}
          </section>
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
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
