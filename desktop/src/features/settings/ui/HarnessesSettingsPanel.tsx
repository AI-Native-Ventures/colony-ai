import * as React from "react";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  useAcpRuntimesQueryForced,
  useGitBashPrerequisiteQuery,
} from "@/features/agents/hooks";
import { useManagedShellSetup } from "@/features/agents/lib/useManagedShellSetup";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

import { HarnessCatalogDialog } from "./HarnessCatalogDialog";
import { HarnessRow } from "./HarnessRow";
import { stableRowOrder, yourHarnessEntries } from "./harnessCatalogLogic";

function GitBashCard({
  prerequisite,
  onReady,
}: {
  prerequisite: NonNullable<
    ReturnType<typeof useGitBashPrerequisiteQuery>["data"]
  >;
  onReady: () => void;
}) {
  const setup = useManagedShellSetup(onReady);
  const canSetUp =
    !prerequisite.available && prerequisite.managedInstallSupported === true;
  return (
    <div
      className={cn(
        "min-h-16 px-4 py-4 text-sm",
        !prerequisite.available && "bg-amber-500/5",
      )}
      data-testid="doctor-git-bash"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Git Bash</p>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
                prerequisite.available
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
              )}
            >
              {prerequisite.available ? "Available" : "Action needed"}
            </span>
          </div>
          {!prerequisite.available ? (
            <div className="flex shrink-0 items-center gap-3">
              {canSetUp ? (
                <button
                  className="cs-button"
                  data-testid="doctor-git-bash-setup"
                  disabled={setup.pending}
                  onClick={setup.start}
                  type="button"
                >
                  {setup.pending
                    ? "Setting up…"
                    : setup.error
                      ? "Try again"
                      : "Set up shell tools"}
                </button>
              ) : null}
              <button
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  void openUrl(prerequisite.installInstructionsUrl)
                }
                type="button"
              >
                <ExternalLink className="h-4 w-4" /> Install Git for Windows
              </button>
            </div>
          ) : null}
        </div>
        {!prerequisite.available ? (
          <div
            className="mt-3 space-y-1 text-sm text-muted-foreground/70"
            data-settings-subcopy
          >
            <p>Required for buzz-agent shell tools on Windows.</p>
            {canSetUp ? (
              <p role="status">
                {setup.pending
                  ? (setup.line ?? "Setting up shell tools…")
                  : "Colony can download its own copy once (about 40 MB), with no admin prompt."}
              </p>
            ) : (
              <p>{prerequisite.installHint}</p>
            )}
            {setup.error ? (
              <p className="text-destructive" role="alert">
                {setup.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Consolidated "Agent runtimes" surface for Settings → Agents.
 *
 * Replaces the old "Agent runtimes" (DoctorSettingsPanel) + "Bring your own
 * harness" (HarnessManagementCard) pair with one operational area:
 *
 * - **Your runtimes**: stable rows for ready (or one-click-ready) runtimes
 *   and everything the user authored. Row order never changes when a runtime
 *   installs (stableRowOrder), so the page doesn't jump under the pointer.
 * - **Add runtimes**: a master-detail catalog dialog for everything that
 *   needs multi-step setup, plus the custom-harness form.
 */
export function HarnessesSettingsPanel() {
  const runtimesQuery = useAcpRuntimesQueryForced();
  const gitBashQuery = useGitBashPrerequisiteQuery();
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  // Incremented each time the user clicks "Check again" so HarnessRow
  // useEffect clears stale install results from before the refresh.
  const [resetEpoch, setResetEpoch] = React.useState(0);

  const entries = React.useMemo(
    () => yourHarnessEntries(runtimesQuery.data ?? []),
    [runtimesQuery.data],
  );

  // Sticky row order: initial sort once, then preserve relative order across
  // refetches/toggles so enabling a harness never reorders the list.
  const orderRef = React.useRef<string[]>([]);
  const rows = React.useMemo(() => {
    orderRef.current = stableRowOrder(orderRef.current, entries);
    const byId = new Map(entries.map((e) => [e.id, e]));
    return orderRef.current
      .map((id) => byId.get(id))
      .filter((e): e is AcpRuntimeCatalogEntry => e !== undefined);
  }, [entries]);

  const isRefreshing = runtimesQuery.isFetching;

  return (
    <div className="cs-led" data-testid="settings-harnesses">
      <div className="cs-harness-head">
        <div className="cs-harness-title">
          <h2 className="cs-section-title">Available harnesses</h2>
          <span className="cs-section-note">
            The programs on this Mac that run your agents.
          </span>
        </div>
        <button
          className="cs-button cs-harness-check"
          disabled={isRefreshing}
          onClick={() => {
            setResetEpoch((e) => e + 1);
            void runtimesQuery.forceRefresh();
            void gitBashQuery.refetch();
          }}
          type="button"
        >
          <RefreshCw
            className={cn("h-4 w-4", isRefreshing && "animate-spin")}
          />
          Check again
        </button>
      </div>

      <div className="cs-card">
        {gitBashQuery.data ? (
          <section>
            <div className="px-4 py-3 text-sm">
              <h3 className="cs-eyebrow">System prerequisites</h3>
              <p className="cs-help">
                Windows tools required by supported agents.
              </p>
            </div>
            <GitBashCard
              onReady={() => void gitBashQuery.refetch()}
              prerequisite={gitBashQuery.data}
            />
          </section>
        ) : null}

        <section aria-label="Your harnesses">
          {runtimesQuery.isLoading ? (
            <div className="cs-harness-empty">Checking agent harnesses…</div>
          ) : rows.length > 0 ? (
            <div data-testid="doctor-runtime-list">
              {rows.map((runtime) => (
                <HarnessRow
                  embedded
                  key={runtime.id}
                  resetEpoch={resetEpoch}
                  runtime={runtime}
                />
              ))}
            </div>
          ) : (
            <div className="cs-harness-empty" data-tone="need">
              No agent harnesses ready yet. Add one below.
            </div>
          )}

          {runtimesQuery.error instanceof Error ? (
            <p className="cs-notice" data-tone="bad">
              {runtimesQuery.error.message}
            </p>
          ) : null}
        </section>
      </div>

      <button
        className="cs-dashed-button"
        data-testid="harness-add-button"
        onClick={() => setCatalogOpen(true)}
        type="button"
      >
        <Plus className="h-4 w-4" />
        Add harness
      </button>

      <HarnessCatalogDialog onOpenChange={setCatalogOpen} open={catalogOpen} />
    </div>
  );
}
