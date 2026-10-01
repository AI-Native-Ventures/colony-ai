import * as React from "react";

import { AgentConfigTextInput } from "@/features/agents/ui/agentConfigControls";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  meshInstalledModels,
  meshModelCatalog,
  meshStartNode,
  meshStopNode,
} from "@/shared/api/tauriMesh";
import type { MeshModelCatalog, MeshModelOption } from "@/shared/api/tauriMesh";
import { SettingsOptionGroup } from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import { classifyModelRef } from "../classifyModelRef";
import { MeshComputeSettingsCard } from "./MeshComputeSettingsCard";
import {
  downloadPercent,
  formatDownloadBytes,
  useMeshDownloadProgress,
} from "../hooks/useMeshDownloadProgress";
import { useMeshConnectedHosts } from "../hooks/useMeshConnectedHosts";
import { useMeshNodeStatus } from "../hooks/useMeshNodeStatus";
import { useMeshServingUsage } from "../hooks/useMeshServingUsage";
import { deriveServingIndicator } from "../servingUsage";
import { deriveMeshShareToggle } from "../shareToggleState";

const MODEL_DRAFT_STORAGE_KEY = "buzz.mesh-compute.share.model.v1";
const MAX_VRAM_DRAFT_STORAGE_KEY = "buzz.mesh-compute.share.max-vram-gb.v1";

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Keep the form usable when local persistence is unavailable.
  }
}

export function MeshComputeWorkspace() {
  const {
    hosts,
    loading: hostsLoading,
    error: hostsError,
    refresh,
  } = useMeshConnectedHosts();
  const {
    status,
    error: statusError,
    refresh: refreshStatus,
  } = useMeshNodeStatus();
  const [catalog, setCatalog] = React.useState<MeshModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = React.useState(true);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const catalogGeneration = React.useRef(0);
  const [installedModels, setInstalledModels] = React.useState<
    MeshModelOption[]
  >([]);
  const [modelInput, setModelInput] = React.useState(() =>
    readDraft(MODEL_DRAFT_STORAGE_KEY),
  );
  const [maxVramGb, setMaxVramGb] = React.useState(() =>
    readDraft(MAX_VRAM_DRAFT_STORAGE_KEY),
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [actionInFlight, setActionInFlight] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<"start" | null>(
    null,
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const { progress: downloadProgress, reset: resetDownloadProgress } =
    useMeshDownloadProgress();

  const loadCatalog = React.useCallback(() => {
    const requestGeneration = ++catalogGeneration.current;
    setCatalogLoading(true);
    setCatalogError(null);
    void meshModelCatalog()
      .then((value) => {
        if (catalogGeneration.current === requestGeneration) {
          setCatalog(value);
          setCatalogError(null);
          setCatalogLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (catalogGeneration.current === requestGeneration) {
          setCatalog(null);
          setCatalogError(
            reason instanceof Error ? reason.message : String(reason),
          );
          setCatalogLoading(false);
        }
      });
  }, []);

  React.useEffect(() => {
    loadCatalog();
    return () => {
      catalogGeneration.current += 1;
    };
  }, [loadCatalog]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: status state intentionally refreshes installed models after runtime transitions.
  React.useEffect(() => {
    let cancelled = false;
    void meshInstalledModels()
      .then((models) => {
        if (!cancelled) setInstalledModels(models);
      })
      .catch(() => {
        if (!cancelled) setInstalledModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status?.state]);

  React.useEffect(() => {
    if (
      status?.state === "running" &&
      status.mode === "serve" &&
      status.modelId &&
      status.modelId !== modelInput
    ) {
      setModelInput(status.modelId);
      writeDraft(MODEL_DRAFT_STORAGE_KEY, status.modelId);
    }
  }, [status?.state, status?.mode, status?.modelId, modelInput]);

  const { isSharing, isConsuming, slotOccupied } =
    deriveMeshShareToggle(status);
  const isStarting = pendingAction === "start" || status?.state === "starting";
  const isSharingReady =
    isSharing && status?.state === "running" && status.health.status === "ok";
  const servingUsage = useMeshServingUsage(isSharingReady);
  const servingIndicator = deriveServingIndicator(servingUsage, isSharingReady);
  const localModels = React.useMemo(() => {
    const byId = new Map<string, MeshModelOption>();
    for (const entry of catalog?.entries ?? []) {
      if (entry.installed)
        byId.set(entry.name, { id: entry.name, name: entry.name });
    }
    for (const model of installedModels) byId.set(model.id, model);
    return [...byId.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }, [catalog?.entries, installedModels]);
  const selectedModel = modelInput.trim();
  const modelRefClass = classifyModelRef(selectedModel);
  const controlsDisabled =
    actionInFlight ||
    (slotOccupied && !isConsuming) ||
    status?.state === "stopping" ||
    status?.state === "failed" ||
    !status ||
    Boolean(statusError) ||
    catalog === null ||
    Boolean(catalogError);
  const canStart =
    modelRefClass.kind !== "unknown" && !controlsDisabled && !isSharing;

  async function handleStart() {
    setActionError(null);
    setPendingAction("start");
    setActionInFlight(true);
    try {
      const maxVram = maxVramGb.trim() === "" ? undefined : Number(maxVramGb);
      await meshStartNode({
        mode: "serve",
        modelId: selectedModel,
        maxVramGb:
          typeof maxVram === "number" && Number.isFinite(maxVram) && maxVram > 0
            ? maxVram
            : undefined,
      });
      refreshStatus();
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionInFlight(false);
      setPendingAction(null);
      resetDownloadProgress();
    }
  }

  async function handleStop() {
    if (!isSharing) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      await meshStopNode();
      refreshStatus();
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionInFlight(false);
    }
  }

  if (hostsLoading || catalogLoading || (!status && !statusError)) {
    return (
      <section data-testid="settings-mesh-loading">
        <SettingsSectionHeader title="Compute" />
        <div className="space-y-5">
          <div className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-4">
            <p className="text-sm font-semibold">Loading the latest record</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Actions become available after the shared source responds.
            </p>
          </div>
          <div aria-hidden="true" className="space-y-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton
                className="h-12 w-full rounded-md bg-muted"
                key={row}
                pulsing={false}
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (
    isConsuming ||
    status?.state === "failed" ||
    status?.state === "stopping" ||
    (status?.state === "running" && status.health.status !== "ok")
  ) {
    // This runtime state has no B2 reference. Keep the shipped consuming-client
    // panel and its guarded replace behavior until that state is designed.
    return <MeshComputeSettingsCard />;
  }

  if (hostsError || statusError || catalogError) {
    return (
      <section data-testid="settings-mesh-unavailable">
        <SettingsSectionHeader title="Compute" />
        <SettingsOptionGroup title="This information could not load">
          <div className="space-y-4 p-4">
            <p className="text-sm text-muted-foreground">
              A connection failure is not an empty record. Your draft is kept.
            </p>
            <Button
              onClick={() => {
                refresh();
                refreshStatus();
                loadCatalog();
              }}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </SettingsOptionGroup>
      </section>
    );
  }

  const noInstalledModels = catalog !== null && localModels.length === 0;

  return (
    <section data-testid="settings-mesh-compute">
      <SettingsSectionHeader title="Compute" />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <section className="min-w-0" data-testid="settings-mesh-share-compute">
          <SettingsOptionGroup title="Share this device’s compute">
            <div className="space-y-5 p-4">
              {actionError ? (
                <div
                  className="rounded-lg border-l-2 border-destructive bg-muted/30 px-4 py-3"
                  role="alert"
                >
                  <p className="text-sm font-semibold">Could not save</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your inputs are kept. Review them or retry without starting
                    again.
                  </p>
                </div>
              ) : null}

              {noInstalledModels && !isSharingReady && !isStarting ? null : (
                <MeshShareState
                  isSharing={isSharingReady}
                  isStarting={isStarting}
                />
              )}
              {servingIndicator.show && !isStarting ? (
                <p
                  className={
                    servingIndicator.hasRemoteConsumers
                      ? "text-2xs text-emerald-600 dark:text-emerald-400"
                      : "text-2xs text-muted-foreground"
                  }
                  data-testid="mesh-serving-usage"
                  title={servingIndicator.detail ?? undefined}
                >
                  {servingIndicator.label}
                  {servingIndicator.detail ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {servingIndicator.detail}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {downloadProgress && !isStarting ? (
                <DownloadProgressBar progress={downloadProgress} />
              ) : null}

              {isSharingReady ? (
                <div className="space-y-4">
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Model</dt>
                    <dd className="truncate font-medium">
                      {status?.modelName ?? status?.modelId ?? selectedModel}
                    </dd>
                    <dt className="text-muted-foreground">Device</dt>
                    <dd className="truncate font-medium">
                      {status?.deviceName ?? "This device"}
                    </dd>
                  </dl>
                  <Button
                    data-testid="mesh-share-compute-stop"
                    disabled={actionInFlight}
                    onClick={handleStop}
                    size="sm"
                    variant="outline"
                  >
                    Stop sharing
                  </Button>
                </div>
              ) : isStarting ? null : (
                <div className="space-y-4">
                  {noInstalledModels ? (
                    <div className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3">
                      <p className="text-sm font-semibold">
                        No installed model found
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Enter a supported model reference to download and
                        prepare it. Sharing stays off until setup succeeds.
                      </p>
                    </div>
                  ) : null}
                  <MeshModelPicker
                    disabled={controlsDisabled}
                    installedModels={localModels}
                    model={modelInput}
                    onModelChange={(value) => {
                      setModelInput(value);
                      writeDraft(MODEL_DRAFT_STORAGE_KEY, value);
                    }}
                  />
                  <details
                    className="border-t border-border/70 pt-4"
                    onToggle={(event) =>
                      setAdvancedOpen(event.currentTarget.open)
                    }
                    open={advancedOpen}
                  >
                    <summary className="cursor-pointer text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                      Advanced resource limits
                    </summary>
                    <div className="mt-3 space-y-2">
                      <label
                        className="block space-y-2 text-sm"
                        htmlFor="mesh-share-compute-vram"
                      >
                        <span>Maximum memory, GB (optional)</span>
                        <AgentConfigTextInput
                          data-testid="mesh-share-compute-vram"
                          disabled={controlsDisabled}
                          id="mesh-share-compute-vram"
                          inputMode="decimal"
                          onChange={(event) => {
                            const value = event.target.value;
                            setMaxVramGb(value);
                            writeDraft(MAX_VRAM_DRAFT_STORAGE_KEY, value);
                          }}
                          type="number"
                          min="1"
                          value={maxVramGb}
                        />
                      </label>
                    </div>
                  </details>
                  <div className="border-t border-border/70 pt-4">
                    <Button
                      data-testid="mesh-share-compute-start"
                      disabled={!canStart}
                      onClick={handleStart}
                      size="sm"
                    >
                      Start sharing
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </SettingsOptionGroup>
        </section>

        <section
          className="min-w-0"
          data-testid="settings-mesh-connected-hosts"
        >
          <SettingsOptionGroup title="Connected hosts">
            <div className="p-4">
              {hosts.length > 0 ? (
                <ul className="divide-y divide-border/70">
                  {hosts.map((host) => (
                    <li
                      className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
                      data-testid="mesh-connected-host"
                      key={host.id}
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                      >
                        {host.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {host.name.trim()}
                        </span>
                        <span className="block text-2xs text-muted-foreground">
                          {host.local ? "Local" : "Remote"} · Available
                        </span>
                      </span>
                      <span className="shrink-0 rounded-md border border-border/70 px-2 py-1 text-2xs text-muted-foreground">
                        {host.local ? "Local" : "Remote"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3">
                <p className="text-sm font-semibold">Models and hosts</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Hosts show where agents run. Sharing offers a model from this
                  device.
                </p>
              </div>
            </div>
          </SettingsOptionGroup>
        </section>
      </div>
    </section>
  );
}

function MeshShareState({
  isSharing,
  isStarting,
}: {
  isSharing: boolean;
  isStarting: boolean;
}) {
  const title = isStarting
    ? "Starting sharing"
    : isSharing
      ? "Sharing is active"
      : "Sharing is off";
  const description = isStarting
    ? "Preparing the selected model. Other people cannot use this device yet."
    : isSharing
      ? "This device is serving the selected model."
      : "Choose a model before starting.";
  return (
    <div
      className="rounded-lg border-l-2 border-primary/60 bg-muted/30 px-4 py-3"
      data-testid="mesh-share-compute-state"
      role={isStarting ? "status" : undefined}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MeshModelPicker({
  disabled,
  installedModels,
  model,
  onModelChange,
}: {
  disabled: boolean;
  installedModels: readonly MeshModelOption[];
  model: string;
  onModelChange: (model: string) => void;
}) {
  const isInstalled = installedModels.some(
    (entry) => entry.id === model.trim(),
  );
  return (
    <div className="space-y-4" data-testid="mesh-share-compute-catalog">
      <label
        className="block space-y-2 text-sm"
        htmlFor="mesh-share-compute-model"
      >
        <span>Local model</span>
        <select
          className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="mesh-share-compute-model"
          disabled={disabled}
          id="mesh-share-compute-model"
          onChange={(event) => onModelChange(event.target.value)}
          value={isInstalled ? model.trim() : ""}
        >
          <option value="">Choose local model</option>
          {installedModels.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name ?? entry.id}
            </option>
          ))}
        </select>
      </label>
      <label
        className="block space-y-2 text-sm"
        htmlFor="mesh-share-compute-model-reference"
      >
        <span>Or a supported model reference</span>
        <AgentConfigTextInput
          aria-label="Or a supported model reference"
          autoCorrect="off"
          data-testid="mesh-share-compute-model-reference"
          disabled={disabled}
          id="mesh-share-compute-model-reference"
          onChange={(event) => onModelChange(event.target.value)}
          placeholder="Model reference or local file"
          value={isInstalled ? "" : model}
        />
      </label>
    </div>
  );
}

function DownloadProgressBar({
  progress,
}: {
  progress: NonNullable<ReturnType<typeof useMeshDownloadProgress>["progress"]>;
}) {
  const percent = downloadPercent(progress);
  const bytes = formatDownloadBytes(progress);
  return (
    <div
      className="rounded-lg bg-muted/30 px-3 py-2"
      data-testid="mesh-download-progress"
    >
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">
          {progress.status === "preparing" ? "Preparing" : "Downloading"}{" "}
          {progress.label}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {percent != null ? `${percent}%` : bytes || "…"}
        </span>
      </div>
      {bytes && percent != null ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{bytes}</p>
      ) : null}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={percent != null ? { width: `${percent}%` } : { width: "25%" }}
        />
      </div>
    </div>
  );
}
