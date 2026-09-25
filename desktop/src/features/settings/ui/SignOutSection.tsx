import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import {
  getActiveDraftEntries,
  useDraftsSnapshot,
} from "@/features/messages/lib/useDrafts";
import { signOut } from "@/shared/api/tauriIdentity";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

type SignOutSectionProps = {
  onOpenDraftRecovery?: () => void;
  variant: "device" | "local-data";
};

export function SignOutSection({
  onOpenDraftRecovery,
  variant,
}: SignOutSectionProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const managedAgentsQuery = useManagedAgentsQuery();
  useDraftsSnapshot();
  const drafts = getActiveDraftEntries();
  const localAgents = (managedAgentsQuery.data ?? []).filter(
    (agent) =>
      agent.backend.type === "local" &&
      agent.status === "running" &&
      isManagedAgentActive(agent),
  ).length;
  const attachmentCount = drafts.reduce(
    (total, { draft }) => total + draft.pendingImeta.length,
    0,
  );
  const hasUnsyncedWork = drafts.length > 0 || attachmentCount > 0;

  async function handleSignOut() {
    setIsPending(true);
    setError(null);
    try {
      await signOut();
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Sign-out could not be completed.",
      );
      setIsPending(false);
    }
  }

  function openDialog() {
    setError(null);
    setIsOpen(true);
  }

  if (variant === "device") {
    return (
      <>
        <Button
          data-testid="signout-open-dialog"
          onClick={openDialog}
          size="sm"
          variant="outline"
        >
          Sign out
        </Button>
        <SignOutDialog
          attachmentCount={attachmentCount}
          draftsCount={drafts.length}
          error={error}
          hasUnsyncedWork={hasUnsyncedWork}
          isOpen={isOpen}
          isPending={isPending}
          localAgents={localAgents}
          onCancel={() => setIsOpen(false)}
          onOpenDraftRecovery={onOpenDraftRecovery}
          onSignOut={() => void handleSignOut()}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border/70 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Remove local data</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose what happens to cached data when you sign out.
          </p>
        </div>
        <Button
          data-testid="signout-open-dialog-remove-data"
          onClick={openDialog}
          size="sm"
          variant="outline"
        >
          Sign out &amp; remove data
        </Button>
      </div>
      <SignOutDialog
        attachmentCount={attachmentCount}
        draftsCount={drafts.length}
        error={error}
        hasUnsyncedWork={hasUnsyncedWork}
        isOpen={isOpen}
        isPending={isPending}
        localAgents={localAgents}
        onCancel={() => setIsOpen(false)}
        onOpenDraftRecovery={onOpenDraftRecovery}
        onSignOut={() => void handleSignOut()}
      />
    </>
  );
}

function SignOutDialog({
  attachmentCount,
  draftsCount,
  error,
  hasUnsyncedWork,
  isOpen,
  isPending,
  localAgents,
  onCancel,
  onOpenDraftRecovery,
  onSignOut,
}: {
  attachmentCount: number;
  draftsCount: number;
  error: string | null;
  hasUnsyncedWork: boolean;
  isOpen: boolean;
  isPending: boolean;
  localAgents: number;
  onCancel: () => void;
  onOpenDraftRecovery?: () => void;
  onSignOut: () => void;
}) {
  const details = [
    draftsCount > 0
      ? `${draftsCount} ${draftsCount === 1 ? "draft" : "drafts"}`
      : null,
    attachmentCount > 0
      ? `${attachmentCount} pending ${attachmentCount === 1 ? "attachment" : "attachments"}`
      : null,
  ].filter(Boolean);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
      open={isOpen}
    >
      <AlertDialogContent
        className="max-w-[34rem] gap-0 overflow-hidden rounded-[0.9rem] border border-border bg-background p-0 shadow-xl"
        data-testid="signout-dialog"
      >
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-5">
          <AlertDialogHeader className="space-y-0">
            <AlertDialogTitle className="text-lg font-medium tracking-normal">
              Sign out of this device?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <Button
            aria-label="Close"
            data-testid="signout-close"
            disabled={isPending}
            onClick={onCancel}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <div className="space-y-6 px-6 py-6">
          <AlertDialogDescription className="text-sm leading-5">
            Your remote business and conversations stay available.
          </AlertDialogDescription>
          {localAgents > 0 ? (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
              <p className="font-medium">
                {localAgents} local{" "}
                {localAgents === 1 ? "agent is" : "agents are"} running
              </p>
              <p>
                Sign-out stops local agents on this device. Remote agents
                continue with their own permissions.
              </p>
            </div>
          ) : null}
          {hasUnsyncedWork ? (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Unsynced work</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {details.join(" · ")}
                </p>
              </div>
              <Button
                className="shrink-0 text-primary"
                data-testid="signout-review-work"
                disabled={!onOpenDraftRecovery || isPending}
                onClick={() => {
                  onCancel();
                  onOpenDraftRecovery?.();
                }}
                size="sm"
                variant="link"
              >
                Review before leaving
              </Button>
            </div>
          ) : null}
          {error ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <AlertDialogFooter className="flex-row border-t border-border/70 px-6 py-4">
          <AlertDialogCancel disabled={isPending} onClick={onCancel}>
            Stay signed in
          </AlertDialogCancel>
          <Button
            data-testid="signout-confirm"
            disabled={isPending}
            onClick={onSignOut}
            type="button"
            variant="outline"
            className="border-destructive/25 text-destructive hover:bg-destructive/5"
          >
            {isPending ? (
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 size-4 animate-spin"
              />
            ) : null}
            {isPending ? "Signing out" : `Stop local agents & sign out`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
