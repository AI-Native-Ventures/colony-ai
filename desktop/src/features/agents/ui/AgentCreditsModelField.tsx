import { Button } from "@/shared/ui/button";
import { PersonaDropdownField } from "./PersonaDropdownField";
import { RefreshModelListButton } from "./RefreshModelListButton";
import { simpleModelLabel } from "./simpleAgentAi";

type AgentCreditsModelFieldProps = {
  disabled: boolean;
  error: boolean;
  loading: boolean;
  model: string;
  models: readonly string[];
  onModelChange: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
};

export function AgentCreditsModelField({
  disabled,
  error,
  loading,
  model,
  models,
  onModelChange,
  onRefresh,
  refreshing,
}: AgentCreditsModelFieldProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label
          className="text-sm font-semibold text-foreground"
          htmlFor="agent-free-model-select"
        >
          Colony free AI
        </label>
        <RefreshModelListButton
          disabled={disabled}
          onClick={onRefresh}
          refreshing={refreshing}
          testId="refresh-agent-models"
        />
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">
          Loading available free models…
        </p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-destructive">
            Free models could not be loaded.
          </p>
          <Button onClick={onRefresh} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </div>
      ) : models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No free models are configured on this relay.
        </p>
      ) : (
        <>
          <PersonaDropdownField
            disabled={disabled}
            id="agent-free-model-select"
            onValueChange={onModelChange}
            options={models.map((id) => ({
              label: simpleModelLabel(id, "colony-credits"),
              value: id,
            }))}
            placeholder="Choose a free model"
            value={models.includes(model.trim()) ? model.trim() : models[0]}
          />
          <p className="text-xs text-muted-foreground">
            Colony tries the next free model automatically when this one is
            busy.
            {models.some((id) => id.startsWith("poolside/laguna-"))
              ? " Laguna models are scheduled to expire 31 Oct."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
