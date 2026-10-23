import { usePreventSleepContext } from "@/features/agents/usePreventSleep";
import { SettingsSwitchRow } from "./SettingsKit";

/** A row of App preferences: keep this Mac awake while agents work. */
export function PreventSleepSettingsCard() {
  const { enabled, setEnabled, hasRunningAgents, expired, clearExpired } =
    usePreventSleepContext();

  return (
    <>
      <SettingsSwitchRow
        checked={enabled}
        help="Stop this Mac from sleeping while an agent here is working."
        id="prevent-sleep-switch"
        label="Keep awake while agents are active"
        onCheckedChange={(checked) => {
          if (expired) {
            clearExpired();
          }
          setEnabled(checked);
        }}
        testId="prevent-sleep-toggle"
      />
      {enabled && !hasRunningAgents ? (
        <p className="cs-row-note">Waiting for agents to start</p>
      ) : null}
      {expired ? (
        <p className="cs-row-note" data-tone="need">
          Sleep prevention expired after 1 hour without agent activity. It will
          resume on the next agent activity, or toggle off and on to re-enable
          now.
        </p>
      ) : null}
    </>
  );
}
