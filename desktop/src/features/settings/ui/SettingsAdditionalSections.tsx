import { AccountSettingsHeader } from "./AccountSettingsHeader";
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
import {
  readAccessibilityPreference,
  saveAccessibilityPreference,
  type AccessibilityPreference,
} from "@/shared/lib/accessibilityPreference";
import "./AccessibilitySettingsPanel.css";
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
import { ModerationQueueCard } from "./ModerationQueueCard";
import { SendFeedbackController } from "./SendFeedbackController";

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

export function AccessibilitySettingsPanel({
  onClose,
}: {
  onClose?: () => void;
}) {
  const [draft, setDraft] = React.useState(readAccessibilityPreference);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  function update(value: Partial<AccessibilityPreference>) {
    setDraft((previous) => ({ ...previous, ...value }));
    setSaved(false);
  }
  return (
    <section
      className="settings-accessibility min-w-0"
      data-testid="settings-accessibility"
    >
      <AccountSettingsHeader title="Accessibility" onBackToToday={onClose} />
      <div className="settings-accessibility-grid">
        <section
          className="settings-accessibility-card"
          aria-labelledby="reading-motion-title"
        >
          <h2 id="reading-motion-title" className="text-base font-semibold">
            Reading & motion
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!saveAccessibilityPreference(draft)) {
                setError(
                  "Could not save accessibility preferences. Try again.",
                );
                return;
              }
              setError("");
              setSaved(true);
            }}
          >
            <label
              htmlFor="accessibility-text-size"
              className="text-sm font-medium"
            >
              Text size
            </label>
            <select
              id="accessibility-text-size"
              value={draft.textSize}
              onChange={(event) =>
                update({
                  textSize: event.target
                    .value as AccessibilityPreference["textSize"],
                })
              }
            >
              {draft.textSize === "smaller" ? (
                <option value="smaller">Smaller</option>
              ) : null}
              <option value="default">Default</option>
              <option value="larger">Larger</option>
            </select>
            <label
              htmlFor="accessibility-motion"
              className="text-sm font-medium"
            >
              Motion
            </label>
            <select
              id="accessibility-motion"
              value={draft.motion}
              onChange={(event) =>
                update({
                  motion: event.target
                    .value as AccessibilityPreference["motion"],
                })
              }
            >
              <option value="system">Use system preference</option>
              <option value="reduce">Reduce motion</option>
            </select>
            <label className="settings-accessibility-check text-sm">
              <input
                type="checkbox"
                checked={draft.keyboardHints}
                onChange={(event) =>
                  update({ keyboardHints: event.target.checked })
                }
              />{" "}
              Show keyboard hints
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="settings-accessibility-save">
              {saved ? (
                <span role="status" className="text-xs text-muted-foreground">
                  Saved
                </span>
              ) : null}
              <button type="submit">Save</button>
            </div>
          </form>
        </section>
        <section
          className="settings-accessibility-card"
          aria-labelledby="accessibility-keyboard-title"
        >
          <h2
            id="accessibility-keyboard-title"
            className="text-base font-semibold"
          >
            Keyboard
          </h2>
          <dl className="settings-accessibility-facts text-sm">
            <dt>Search</dt>
            <dd>⌘ / Ctrl K</dd>
            <dt>Send draft</dt>
            <dd>⌘ / Ctrl Enter</dd>
            <dt>Close dialog</dt>
            <dd>Escape</dd>
            <dt>Resize sidebar</dt>
            <dd>Focus its divider, then arrow keys</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Visible focus, native form labels and reduced-motion states are part
            of the review.
          </p>
        </section>
      </div>
    </section>
  );
}

export function ArchivedRecordsSettingsPanel({
  onClose,
}: {
  onClose?: () => void;
}) {
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
        action={
          <Button
            className="h-8 px-3 text-xs"
            data-testid="settings-archive-back-to-today"
            onClick={onClose}
            size="sm"
            variant="outline"
          >
            Back to Today
          </Button>
        }
      />
      <SettingsOptionGroup title="Archived records">
        {archivedQuery.isLoading ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              Loading archived records…
            </p>
          </SettingsOptionRow>
        ) : null}
        {archivedQuery.isError ? (
          <SettingsOptionRow>
            <p className="text-sm text-destructive">
              Archived records could not be loaded.
            </p>
          </SettingsOptionRow>
        ) : null}
        {!archivedQuery.isLoading &&
        !archivedQuery.isError &&
        identities.length === 0 ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              No archived records.
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
