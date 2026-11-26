import type { AgentHomeModel } from "../placement/useAgentHome";
import { AgentHomeSettingsSection } from "../placement/AgentHomeSettings";
import { settingsTitle } from "../placement/placementCopy";

/**
 * The profile's own place for the "This Mac / Cloud" switch, the same control
 * and words as the Edit dialog (spec 5.5). Nothing when the switch does not
 * apply: an agent that is not yours, or an account without cloud agents.
 */
export function AgentPageHome({ model }: { model: AgentHomeModel }) {
  if (!model.show) return null;
  return (
    <section
      aria-labelledby="agent-home"
      className="agents-c3-card"
      data-gap="10"
      data-testid="agent-profile-home"
    >
      <h2 className="agents-c3-eyebrow" id="agent-home">
        {settingsTitle(model.name)}
      </h2>
      <AgentHomeSettingsSection
        model={model}
        onChoose={(home) => void model.choose(home)}
        onChooseModel={(id) => void model.chooseModel(id)}
        showTitle={false}
      />
    </section>
  );
}
