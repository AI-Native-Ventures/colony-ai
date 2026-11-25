import { Badge } from "@/shared/ui/badge";
import { SegmentedControl } from "@/shared/ui/segmented-control";

import {
  cloudStatusLine,
  notCloudReadyMessage,
  settingsTitle,
} from "./placementCopy";
import type { AgentHomeModel } from "./useAgentHome";
import { useAgentHome } from "./useAgentHome";
import type { Home } from "./placementTypes";

/**
 * "Where {name} works": the agent profile's second place for the switch (spec
 * 5.5). Changes apply at once, not with Save: moving an agent is a relay
 * command, not an edit of its setup.
 */
export function AgentHomeSettingsSection({
  model,
  onChoose,
  onChooseModel,
}: {
  model: AgentHomeModel;
  onChoose: (home: Home) => void;
  onChooseModel: (modelId: string) => void;
}) {
  const { placement } = model;
  const cloudBlocked = model.notCloudReady && placement.home !== "cloud";
  const statusLine = cloudStatusLine(placement.status);
  return (
    <div className="space-y-2" data-testid="agent-home-settings">
      <p
        aria-hidden="true"
        className="text-sm font-medium text-foreground"
        data-testid="agent-home-settings-title"
      >
        {settingsTitle(model.name)}
      </p>
      <SegmentedControl<Home>
        disabled={model.pending}
        legend={settingsTitle(model.name)}
        onValueChange={(home) => {
          if (home === "cloud" && cloudBlocked) return;
          onChoose(home);
        }}
        optionTestIdPrefix="agent-home-setting"
        options={[
          { value: "mac", label: "This Mac" },
          { value: "cloud", label: "Cloud" },
        ]}
        testId="agent-home-setting"
        value={placement.home}
      />
      <p className="text-xs text-muted-foreground">
        {placement.home === "cloud"
          ? model.cloudLabel
          : model.macLabel
            ? `Uses ${model.macLabel}`
            : "Runs on this computer"}
      </p>
      {placement.home === "cloud" && statusLine ? (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="agent-home-settings-status"
        >
          <Badge className="h-6 px-2 text-2xs" variant="idle">
            {model.status}
          </Badge>
          <span>{statusLine}</span>
        </p>
      ) : null}
      {placement.home === "cloud" && model.cloudModels.length > 1 ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Cloud model</span>
          <select
            className="h-8 rounded-md border border-colony-border bg-colony-pop px-2 text-xs text-colony-fg"
            data-testid="agent-home-cloud-model"
            disabled={model.pending}
            onChange={(event) => onChooseModel(event.target.value)}
            value={model.cloudModelId ?? ""}
          >
            {model.cloudModels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {cloudBlocked ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="agent-home-settings-not-ready"
        >
          {notCloudReadyMessage(model.name)}
        </p>
      ) : null}
      {model.message ? (
        <p
          className="text-xs text-colony-need"
          data-testid="agent-home-settings-message"
          role="status"
        >
          {model.message}
        </p>
      ) : null}
    </div>
  );
}

/** The profile section for one agent; nothing when the switch does not apply. */
export function AgentHomeSettings({ pubkey }: { pubkey: string }) {
  const model = useAgentHome(pubkey);
  if (!model.show) return null;
  return (
    <AgentHomeSettingsSection
      model={model}
      onChoose={(home) => void model.choose(home)}
      onChooseModel={(id) => void model.chooseModel(id)}
    />
  );
}
