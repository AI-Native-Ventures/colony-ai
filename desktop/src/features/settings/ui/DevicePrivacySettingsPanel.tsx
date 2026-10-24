import * as React from "react";

import { useIdentityQuery } from "@/shared/api/hooks";
import {
  readDevicePrivacyPreferences,
  writeDevicePrivacyPreferences,
  type DevicePrivacyPreferences,
} from "../lib/devicePrivacyPreferences";
import { SettingsCard, SettingsSwitchRow } from "./SettingsKit";

export function DevicePrivacySettingsPanel() {
  const identity = useIdentityQuery();
  const pubkey = identity.data?.pubkey;
  return (
    <DevicePrivacyPreferencesPanel
      key={pubkey ?? "identity-pending"}
      pubkey={pubkey}
    />
  );
}

/** Each switch applies at once; there is nothing to save afterwards. */
function DevicePrivacyPreferencesPanel({
  pubkey,
}: {
  pubkey: string | undefined;
}) {
  const [preferences, setPreferences] =
    React.useState<DevicePrivacyPreferences>(() =>
      readDevicePrivacyPreferences(pubkey),
    );
  const [saveFailed, setSaveFailed] = React.useState(false);

  function update(next: Partial<DevicePrivacyPreferences>) {
    const merged = { ...preferences, ...next };
    const didSave = writeDevicePrivacyPreferences(pubkey, merged);
    setSaveFailed(!didSave);
    if (didSave) setPreferences(merged);
  }

  return (
    <>
      <SettingsCard
        data-testid="settings-privacy"
        title="Privacy"
        titleId="privacy-title"
      >
        <SettingsSwitchRow
          checked={preferences.showMessageText}
          id="privacy-message-previews"
          label="Show message text in desktop notifications"
          onCheckedChange={(showMessageText) => update({ showMessageText })}
          testId="privacy-message-text"
        />
        <SettingsSwitchRow
          checked={preferences.shareTypingActivity}
          id="privacy-typing-activity"
          label="Share typing activity with the conversation"
          onCheckedChange={(shareTypingActivity) =>
            update({ shareTypingActivity })
          }
          testId="privacy-typing-activity"
        />
      </SettingsCard>
      {saveFailed ? (
        <p className="cs-notice" data-tone="bad" role="alert">
          Could not save your privacy preferences. Try again.
        </p>
      ) : null}
    </>
  );
}
