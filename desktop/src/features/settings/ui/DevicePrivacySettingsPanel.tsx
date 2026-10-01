import * as React from "react";

import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { SettingsOptionGroup } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import {
  readDevicePrivacyPreferences,
  writeDevicePrivacyPreferences,
  type DevicePrivacyPreferences,
} from "../lib/devicePrivacyPreferences";

export function DevicePrivacySettingsPanel({
  onReviewDevices,
}: {
  onReviewDevices: () => void;
}) {
  const identity = useIdentityQuery();
  const pubkey = identity.data?.pubkey;
  return (
    <DevicePrivacyPreferencesPanel
      key={pubkey ?? "identity-pending"}
      onReviewDevices={onReviewDevices}
      pubkey={pubkey}
    />
  );
}

function DevicePrivacyPreferencesPanel({
  onReviewDevices,
  pubkey,
}: {
  onReviewDevices: () => void;
  pubkey: string | undefined;
}) {
  const [draft, setDraft] = React.useState<DevicePrivacyPreferences>(() =>
    readDevicePrivacyPreferences(pubkey),
  );
  const [saved, setSaved] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);

  function updateDraft(next: Partial<DevicePrivacyPreferences>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaved(false);
    setSaveFailed(false);
  }

  function save() {
    const didSave = writeDevicePrivacyPreferences(pubkey, draft);
    setSaveFailed(!didSave);
    setSaved(didSave);
  }

  return (
    <section className="min-w-0" data-testid="settings-privacy">
      <SettingsSectionHeader title="Privacy" />
      {saved ? (
        <SettingsOptionGroup title="Privacy">
          <div className="space-y-4 p-4" role="status">
            <div>
              <p className="text-sm font-semibold">Privacy preferences saved</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The selections apply to this device. Existing conversations are
                unchanged.
              </p>
            </div>
            <Button onClick={() => setSaved(false)} size="sm" variant="outline">
              Return to Privacy
            </Button>
          </div>
        </SettingsOptionGroup>
      ) : (
        <SettingsOptionGroup title="What this device reveals">
          <div className="space-y-4 p-4">
            {saveFailed ? (
              <div
                className="rounded-lg border border-border border-l-2 border-destructive bg-muted/60 p-4 text-sm"
                role="alert"
              >
                <strong className="text-destructive">Could not save</strong>
                <p className="mt-1 text-muted-foreground">
                  Your inputs are kept. Review them or retry without starting
                  again.
                </p>
              </div>
            ) : null}
            <label
              className="flex min-h-11 items-center gap-3 text-sm"
              htmlFor="privacy-message-previews"
            >
              <Checkbox
                checked={draft.showMessageText}
                data-testid="privacy-message-text"
                id="privacy-message-previews"
                onCheckedChange={(checked) =>
                  updateDraft({ showMessageText: checked === true })
                }
              />
              <span>Show message text in desktop notifications</span>
            </label>
            <div className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3">
              <p className="text-sm font-semibold">Notification previews</p>
              <p className="mt-1 text-sm text-muted-foreground">
                When off, notifications identify activity without displaying
                message text.
              </p>
            </div>

            <label
              className="flex min-h-11 items-center gap-3 text-sm"
              htmlFor="privacy-typing-activity"
            >
              <Checkbox
                checked={draft.shareTypingActivity}
                data-testid="privacy-typing-activity"
                id="privacy-typing-activity"
                onCheckedChange={(checked) =>
                  updateDraft({ shareTypingActivity: checked === true })
                }
              />
              <span>Share typing activity with the conversation</span>
            </label>
            <div className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3">
              <p className="text-sm font-semibold">Conversation presence</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Turning this off hides your typing indicator; it does not hide
                sent messages.
              </p>
            </div>

            <div>
              <Button onClick={onReviewDevices} size="sm" variant="outline">
                Review signed-in devices
              </Button>
            </div>
            <div className="border-t border-border/70 pt-4">
              <Button onClick={save} size="sm">
                Save privacy preferences
              </Button>
            </div>
          </div>
        </SettingsOptionGroup>
      )}
    </section>
  );
}
