import {
  setKeepMentionedAgentsPinned,
  useKeepMentionedAgentsPinned,
} from "@/features/messages/lib/autoPinMentionedAgentsPreference";
import { SettingsSwitchRow } from "./SettingsKit";

/** A row of App preferences: keep the agents you addressed for your replies. */
export function KeepAddressedAgentsSettingsCard() {
  const keepAddressedAgentsSelected = useKeepMentionedAgentsPinned();

  return (
    <SettingsSwitchRow
      checked={keepAddressedAgentsSelected}
      help="After you mention an agent in a thread, keep it addressed in your next replies."
      id="keep-addressed-agents-selected-switch"
      label="Keep addressed agents selected"
      onCheckedChange={setKeepMentionedAgentsPinned}
      testId="settings-keep-addressed-agents"
    />
  );
}
