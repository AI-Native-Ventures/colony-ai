import * as React from "react";

import {
  SettingsCard,
  SettingsSwitchRow,
} from "@/features/settings/ui/SettingsKit";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listSaveSubscriptions } from "@/shared/api/tauriArchive";
import { isLocalArchiveOn, setLocalArchiveOn } from "../localArchiveSwitch";

/**
 * The only local-archive control left in Settings: one switch, drawn like the
 * Preferences switch rows. Its state is read from what is actually saved, so a
 * failed change never leaves the switch lying about what is archived.
 */
export function LocalArchiveSwitch() {
  const pubkey = useIdentityQuery().data?.pubkey ?? "";
  const [on, setOn] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setOn(isLocalArchiveOn(await listSaveSubscriptions()));
      return true;
    } catch (error) {
      console.warn("[LocalArchiveSwitch] could not read the archive:", error);
      return false;
    }
  }, []);

  React.useEffect(() => {
    void reload().then((read) => {
      if (!read) setFailed(true);
    });
  }, [reload]);

  const change = React.useCallback(
    async (next: boolean) => {
      if (!pubkey) return;
      setBusy(true);
      setFailed(false);
      try {
        await setLocalArchiveOn(pubkey, next);
      } catch (error) {
        console.warn("[LocalArchiveSwitch] change failed:", error);
        setFailed(true);
      } finally {
        await reload();
        setBusy(false);
      }
    },
    [pubkey, reload],
  );

  return (
    <>
      <SettingsCard
        data-testid="settings-local-archive"
        title="On this computer"
        titleId="local-archive-title"
      >
        <SettingsSwitchRow
          checked={on === true}
          disabled={busy || on === null || !pubkey}
          help="Messages and agent activity are saved here so they stay readable. Turn it off to stop saving; what is already saved stays."
          id="local-archive-switch"
          label="Keep a copy of messages on this computer"
          onCheckedChange={(next) => {
            void change(next);
          }}
          testId="local-archive-switch"
        />
      </SettingsCard>
      {failed ? (
        <p className="cs-notice" data-tone="bad" role="alert">
          Could not change the local archive. Try again.
        </p>
      ) : null}
    </>
  );
}
