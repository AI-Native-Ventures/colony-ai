import * as React from "react";
import { RotateCcw, Send } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { CommunityIconSettingsCard } from "@/features/communities/ui/CommunityIconSettingsCard";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  useArchivedIdentitiesQuery,
  useUnarchiveIdentityMutation,
} from "@/features/identity-archive/hooks";
import {
  deleteDraftEntry,
  getActiveDraftEntries,
  useDraftsSnapshot,
} from "@/features/messages/lib/useDrafts";
import { useFontSize, setFontSize } from "@/shared/lib/fontSizePreference";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { HarnessesSettingsPanel } from "./HarnessesSettingsPanel";
import { PreventSleepSettingsCard } from "./PreventSleepSettingsCard";
import { KeepAddressedAgentsSettingsCard } from "./KeepAddressedAgentsSettingsCard";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";
import { ModerationQueueCard } from "./ModerationQueueCard";
import { SendFeedbackController } from "./SendFeedbackController";
import { cn } from "@/shared/lib/cn";

export function BusinessProfileSettingsPanel() {
  const { activeCommunity } = useCommunities();
  return (
    <section className="min-w-0" data-testid="settings-business-profile">
      <SettingsSectionHeader
        title="Business profile"
        description="The workspace identity people see when they connect."
      />
      <SettingsOptionGroup title="Workspace">
        {activeCommunity ? (
          <>
            <SettingsOptionRow>
              <div className="min-w-0">
                <p className="text-sm font-medium">{activeCommunity.name}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {activeCommunity.relayUrl}
                </p>
              </div>
            </SettingsOptionRow>
            <CommunityIconSettingsCard compact />
          </>
        ) : (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              No active workspace is connected.
            </p>
          </SettingsOptionRow>
        )}
      </SettingsOptionGroup>
    </section>
  );
}

export function HarnessLifecycleSettingsPanel() {
  return <HarnessesSettingsPanel />;
}

export function AuditSettingsPanel() {
  return <ModerationQueueCard initialTab="audit" title="Audit trail" />;
}

export function AppPreferencesSettingsPanel() {
  return (
    <section className="min-w-0" data-testid="settings-app-preferences">
      <SettingsSectionHeader
        title="App preferences"
        description="Control how the desktop app behaves on this device."
      />
      <KeepAddressedAgentsSettingsCard />
      <PreventSleepSettingsCard />
    </section>
  );
}

function FeedbackLauncher() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <SettingsOptionGroup title="Help improve Colony">
        <SettingsOptionRow>
          <p className="text-sm text-muted-foreground">
            Share feedback with the team.
          </p>
          <Button
            data-testid="feedback-open"
            onClick={() => setOpen(true)}
            size="sm"
            variant="outline"
          >
            <Send aria-hidden="true" className="mr-1.5 size-4" /> Send feedback
          </Button>
        </SettingsOptionRow>
      </SettingsOptionGroup>
      <SendFeedbackController onOpenChange={setOpen} open={open} />
    </>
  );
}

export function FeedbackSettingsPanel() {
  return (
    <section className="min-w-0" data-testid="settings-feedback">
      <SettingsSectionHeader
        title="Send feedback"
        description="Share a note with the Colony team."
      />
      <FeedbackLauncher />
    </section>
  );
}

export function AccessibilitySettingsPanel() {
  const fontSize = useFontSize();
  const prefersReducedMotion = React.useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  return (
    <section className="min-w-0" data-testid="settings-accessibility">
      <SettingsSectionHeader
        title="Accessibility"
        description="Adjust reading comfort and keyboard guidance."
      />
      <SettingsOptionGroup title="Reading & motion">
        <SettingsOptionRow>
          <div>
            <p className="text-sm font-medium">Text size</p>
            <p className="text-xs text-muted-foreground">
              Applies across Colony.
            </p>
          </div>
          <fieldset className="flex gap-1 rounded-lg border border-border/70 bg-muted/35 p-1">
            <legend className="sr-only">Text size</legend>
            {(["default", "larger"] as const).map((size) => (
              <button
                aria-pressed={fontSize === size}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs",
                  fontSize === size
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                key={size}
                onClick={() => setFontSize(size)}
                type="button"
              >
                {size === "default" ? "Default" : "Larger"}
              </button>
            ))}
          </fieldset>
        </SettingsOptionRow>
        <SettingsOptionRow>
          <div>
            <p className="text-sm font-medium">Motion</p>
            <p className="text-xs text-muted-foreground">
              Reduced motion follows your operating system.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {prefersReducedMotion ? "Reduced" : "System default"}
          </span>
        </SettingsOptionRow>
        <SettingsOptionRow>
          <div>
            <p className="text-sm font-medium">Keyboard hints</p>
            <p className="text-xs text-muted-foreground">
              Shortcut reference is available below.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            Always shown in shortcut reference
          </span>
        </SettingsOptionRow>
      </SettingsOptionGroup>
      <div className="mt-4">
        <KeyboardShortcutsCard />
      </div>
    </section>
  );
}

export function ArchivedRecordsSettingsPanel() {
  const archivedQuery = useArchivedIdentitiesQuery();
  const unarchiveMutation = useUnarchiveIdentityMutation();
  const identities = archivedQuery.data?.archived ?? [];

  function restore(pubkey: string) {
    unarchiveMutation.mutate(
      { targetPubkey: pubkey },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not restore this identity.",
          ),
      },
    );
  }

  return (
    <section className="min-w-0" data-testid="settings-archived-records">
      <SettingsSectionHeader
        title="Archived records"
        description="Identities archived from community discovery."
      />
      <SettingsOptionGroup title="Archived identities">
        {archivedQuery.isLoading ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              Loading archived identities…
            </p>
          </SettingsOptionRow>
        ) : null}
        {archivedQuery.isError ? (
          <SettingsOptionRow>
            <p className="text-sm text-destructive">
              Archived identities could not be loaded.
            </p>
          </SettingsOptionRow>
        ) : null}
        {!archivedQuery.isLoading &&
        !archivedQuery.isError &&
        identities.length === 0 ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              No archived identities.
            </p>
          </SettingsOptionRow>
        ) : null}
        {identities.map((pubkey) => (
          <SettingsOptionRow key={pubkey}>
            <p className="min-w-0 break-all font-mono text-xs text-muted-foreground">
              {pubkey}
            </p>
            <Button
              disabled={unarchiveMutation.isPending}
              onClick={() => restore(pubkey)}
              size="sm"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" className="mr-1 size-3.5" /> Restore
            </Button>
          </SettingsOptionRow>
        ))}
      </SettingsOptionGroup>
    </section>
  );
}

export function DraftRecoverySettingsPanel() {
  useDraftsSnapshot();
  const navigate = useNavigate();
  const [discarding, setDiscarding] = React.useState<string | null>(null);
  const drafts = getActiveDraftEntries();
  return (
    <section className="min-w-0" data-testid="settings-draft-recovery">
      <SettingsSectionHeader
        title="Draft recovery"
        description="Review unsent work saved on this device."
      />
      <SettingsOptionGroup title="Saved drafts">
        {drafts.length === 0 ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              No drafts to recover.
            </p>
          </SettingsOptionRow>
        ) : null}
        {drafts.map(({ key, draft }) => (
          <SettingsOptionRow className="items-start" key={key}>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-foreground">
                {draft.content || "Draft with attachments"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {draft.channelId} · {new Date(draft.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                onClick={() =>
                  void navigate({
                    to: "/channels/$channelId",
                    params: { channelId: draft.channelId },
                  })
                }
                size="sm"
                variant="outline"
              >
                Continue draft
              </Button>
              <Button
                onClick={() => setDiscarding(key)}
                size="sm"
                variant="ghost"
              >
                Discard
              </Button>
            </div>
          </SettingsOptionRow>
        ))}
      </SettingsOptionGroup>
      <p className="mt-3 text-xs text-muted-foreground">
        Drafts remain available in their channel until you send or discard them.
      </p>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
        open={discarding !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved draft from this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (discarding) deleteDraftEntry(discarding);
                setDiscarding(null);
              }}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function BusinessConnectionsSettingsPanel() {
  return null;
}
