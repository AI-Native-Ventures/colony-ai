import * as React from "react";
import { discoverAgentModels } from "@/shared/api/agentModels";
import type {
  AcpRuntimeCatalogEntry,
  AgentModelsResponse,
  GlobalAgentConfig,
} from "@/shared/api/types";
import { AgentDropdownSelect } from "@/features/agents/ui/agentConfigControls";

/** Offer only models negotiated by the selected adapter, with read-only fallback. */
export function OnboardingRuntimeModel({
  runtime,
  config,
  model,
  onChange,
}: {
  runtime: AcpRuntimeCatalogEntry;
  config: GlobalAgentConfig;
  model: string | null | undefined;
  onChange: (model: string | null) => void;
}) {
  const [catalog, setCatalog] = React.useState<AgentModelsResponse | null>(
    null,
  );
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let current = true;
    setCatalog(null);
    setError(false);
    if (!runtime.command) return;
    void discoverAgentModels({
      agentCommand: runtime.command,
      agentArgs: runtime.defaultArgs,
      envVars: config.env_vars,
    })
      .then((result) => {
        if (current) setCatalog(result);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [runtime.command, runtime.defaultArgs, config.env_vars]);
  const currentModel = catalog?.selectedModel ?? catalog?.agentDefaultModel;
  return (
    <div className="power-caption">
      <label className="block text-sm" htmlFor="onboarding-runtime-model">
        Model
      </label>
      {catalog?.supportsSwitching && catalog.models.length ? (
        <AgentDropdownSelect
          id="onboarding-runtime-model"
          testId="onboarding-runtime-model"
          options={[
            {
              value: "",
              label: currentModel
                ? `Default (${currentModel})`
                : "Harness default",
            },
            ...catalog.models.map((option) => ({
              value: option.id,
              label: option.name || option.id,
            })),
          ]}
          value={model ?? ""}
          onValueChange={(value) => onChange(value || null)}
        />
      ) : (
        <p role="status">
          {error
            ? "Model discovery is unavailable. The test will check the harness's effective model."
            : catalog
              ? (currentModel ??
                "The harness will report its effective model during the test.")
              : "Loading models..."}
        </p>
      )}
    </div>
  );
}
