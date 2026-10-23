import * as React from "react";
import { Send } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsCard } from "./SettingsKit";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { HarnessesSettingsPanel } from "./HarnessesSettingsPanel";
import { PreventSleepSettingsCard } from "./PreventSleepSettingsCard";
import { KeepAddressedAgentsSettingsCard } from "./KeepAddressedAgentsSettingsCard";
import { SendFeedbackController } from "./SendFeedbackController";

export function HarnessLifecycleSettingsPanel() {
  return <HarnessesSettingsPanel />;
}

export function AppPreferencesSettingsPanel() {
  return (
    <SettingsCard
      data-testid="settings-app-preferences"
      title="App preferences"
      titleId="app-preferences-title"
    >
      <KeepAddressedAgentsSettingsCard />
      <PreventSleepSettingsCard />
    </SettingsCard>
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
