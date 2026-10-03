import * as React from "react";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { SettingsOptionGroup } from "./SettingsOptionGroup";

export function AgentDefaultsSettingsCard() {
  const [revision, setRevision] = React.useState(0);
  return (
    <SettingsOptionGroup
      data-testid="settings-global-agent-config"
      description="Provider, model, effort, and environment settings inherited by local agents. Agent-specific settings always take priority."
      title="Agent defaults"
    >
      <div className="px-4 py-4">
        <OpenRouterConnectionPanel
          onSaved={() => setRevision((value) => value + 1)}
        />
        <section className="mt-4" aria-label="Bring your own key">
          <h4 className="mb-3 text-sm font-semibold">Bring your own key</h4>
          <AgentDefaultsEditor key={revision} layout="flat" />
        </section>
      </div>
    </SettingsOptionGroup>
  );
}
