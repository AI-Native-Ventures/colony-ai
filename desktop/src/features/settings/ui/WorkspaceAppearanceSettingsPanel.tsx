import { Button } from "@/shared/ui/button";
import { SettingsOptionGroup } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import type { ConversationDensity } from "@/shared/lib/conversationDensityPreference";

function themeLabel(name: string): string {
  if (name === "buzz") return "Colony";
  if (name === "buzz-dark") return "Colony Dark";
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function WorkspaceAppearanceSettingsPanel({
  density,
  saveFailed,
  savedDensity,
  savedTheme,
  onDensityChange,
  onOpenThemeCatalog,
  onReturn,
  onSave,
  saved = false,
}: {
  density: ConversationDensity;
  saveFailed: boolean;
  savedDensity: ConversationDensity;
  savedTheme: string;
  onDensityChange: (density: ConversationDensity) => void;
  onOpenThemeCatalog: () => void;
  onReturn: () => void;
  onSave: () => void;
  saved?: boolean;
}) {
  return (
    <section className="min-w-0" data-testid="settings-appearance">
      <SettingsSectionHeader title="Appearance" />
      {saved ? (
        <SettingsOptionGroup title="Appearance updated">
          <div className="space-y-4 p-4" role="status">
            <p className="text-sm text-muted-foreground">
              {themeLabel(savedTheme)} · {densityLabel(savedDensity)}. The
              preference is saved as one selection.
            </p>
            <Button onClick={onReturn} size="sm" variant="outline">
              Return to Appearance
            </Button>
          </div>
        </SettingsOptionGroup>
      ) : (
        <SettingsOptionGroup title="Workspace appearance">
          <div className="space-y-5 p-4">
            {saveFailed ? (
              <div
                className="rounded-lg border border-border border-l-2 border-destructive bg-muted/60 p-4 text-sm"
                role="alert"
              >
                <strong className="text-destructive">Could not save</strong>
                <p className="mt-1 text-muted-foreground">
                  Your inputs are kept. Review them or retry without starting
                  again.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Button onClick={onOpenThemeCatalog} size="sm">
                Browse named themes
              </Button>
              <label
                className="block space-y-2 text-sm"
                htmlFor="workspace-message-density"
              >
                <span>Message density</span>
                <select
                  className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="appearance-density"
                  id="workspace-message-density"
                  onChange={(event) =>
                    onDensityChange(
                      event.target.value as Exclude<
                        ConversationDensity,
                        "spacious"
                      >,
                    )
                  }
                  value={density === "spacious" ? "" : density}
                >
                  <option disabled value="">
                    Choose message density
                  </option>
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
              </label>
            </div>
            <div className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3">
              <p className="text-sm font-semibold">One home for appearance</p>
              <p
                className="mt-1 text-sm text-muted-foreground"
                data-settings-subcopy
              >
                Theme, preview and density live here, inside workspace settings.
                They do not add more sidebar sections.
              </p>
            </div>
            <div className="border-t border-border/70 pt-4">
              <Button onClick={onSave} size="sm">
                Save appearance
              </Button>
            </div>
          </div>
        </SettingsOptionGroup>
      )}
    </section>
  );
}

export function densityLabel(density: ConversationDensity): string {
  return density.charAt(0).toUpperCase() + density.slice(1);
}
