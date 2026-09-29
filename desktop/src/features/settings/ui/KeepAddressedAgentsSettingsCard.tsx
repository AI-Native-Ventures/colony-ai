import {
  setKeepMentionedAgentsPinned,
  useKeepMentionedAgentsPinned,
} from "@/features/messages/lib/autoPinMentionedAgentsPreference";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

export function KeepAddressedAgentsSettingsCard() {
  const keepAddressedAgentsSelected = useKeepMentionedAgentsPinned();

  return (
    <SettingsOptionGroup
      data-testid="settings-keep-addressed-agents"
      title="Working with agents"
    >
      <SettingsOptionRow>
        <div className="min-w-0">
          <label
            className="text-sm font-medium"
            htmlFor="keep-addressed-agents-selected-switch"
          >
            Keep addressed agents selected
          </label>
          <p className="text-sm font-normal text-muted-foreground/70">
            Keep the audience for your next message; remove agents in the
            composer.
          </p>
        </div>
        <Switch
          aria-label="Keep addressed agents selected"
          checked={keepAddressedAgentsSelected}
          id="keep-addressed-agents-selected-switch"
          onCheckedChange={setKeepMentionedAgentsPinned}
        />
      </SettingsOptionRow>
    </SettingsOptionGroup>
  );
}
