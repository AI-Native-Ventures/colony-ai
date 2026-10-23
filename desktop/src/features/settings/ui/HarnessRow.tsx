import * as React from "react";
import { ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  useAcpAuthMethodsQuery,
  useConnectAcpRuntimeMutation,
  useDeleteCustomHarnessMutation,
  useInstallAcpRuntimeMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useInstallOutputLine } from "@/features/agents/lib/useInstallOutputLine";
import { RuntimeIcon } from "@/features/onboarding/ui/RuntimeIcon";
import type { AcpAuthMethod, AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { getInstallErrorMessage } from "@/shared/lib/installError";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { SettingsAlertDialogContent } from "@/shared/ui/settings-alert-dialog-content";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Spinner } from "@/shared/ui/spinner";

import { CustomHarnessForm } from "./CustomHarnessForm";
import { HarnessInstallDialog } from "./HarnessInstallDialog";
import {
  adapterUpdateWarning,
  entryStatusLabel,
  isDownloadPageUrl,
} from "./harnessCatalogLogic";
import { formValuesFromCatalogEntry } from "./harnessFormLogic";
import { deleteConfirmState } from "./harnessGalleryLogic";

/** Link label for the row's install-instructions URL. Distinct from the
 * catalog's `installLinkLabel` — rows spell out what the guide covers
 * (adapter vs CLI) because the row lacks the catalog's setup context. */
function runtimeInstallGuideLabel(runtime: AcpRuntimeCatalogEntry) {
  if (
    runtime.availability === "adapter_missing" ||
    runtime.availability === "adapter_outdated"
  ) {
    return "Adapter install guide";
  }
  return isDownloadPageUrl(runtime.installInstructionsUrl)
    ? "Download page"
    : "CLI setup guide";
}

function RuntimeLogo({ runtime }: { runtime: AcpRuntimeCatalogEntry }) {
  // Single logo pipeline: RuntimeIcon owns every runtime asset — the
  // theme-adaptive RUNTIME_MARKS, the BuzzMark, the bundled bitmap maps
  // (RUNTIME_LOGOS / PRESET_LOGOS), and the terminal-glyph fallback. It never
  // renders remote or user-supplied avatar URLs (security line), so the row
  // and the catalog cannot drift apart.
  return (
    <span
      className="cs-harness-tile"
      data-testid={`doctor-runtime-logo-${runtime.id}`}
    >
      <RuntimeIcon className="h-6 w-6" runtime={runtime} />
    </span>
  );
}

function RuntimeOverflowMenu({
  authMethods,
  connectingMethodId,
  isConnecting,
  onConnect,
  onDelete,
  onEdit,
  runtime,
  triggerLabel,
  triggerTone,
}: {
  /** What the trigger reads: "Manage", "Sign in" or "Set up". */
  triggerLabel: string;
  triggerTone?: "primary";
  authMethods: AcpAuthMethod[];
  connectingMethodId: string | null;
  isConnecting: boolean;
  onConnect: (method: AcpAuthMethod) => void;
  onDelete?: () => void;
  onEdit?: () => void;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const hasInstructions =
    runtime.installInstructionsUrl.trim().length > 0 &&
    (runtime.availability !== "available" ||
      runtime.authStatus.status === "logged_out" ||
      runtime.authStatus.status === "config_invalid");
  const hasActions =
    runtime.nodeRequired ||
    hasInstructions ||
    authMethods.length > 0 ||
    Boolean(onEdit) ||
    Boolean(onDelete);

  if (!hasActions) {
    return null;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Open actions for ${runtime.label}`}
          className="cs-button cs-harness-action"
          data-testid={`doctor-runtime-menu-${runtime.id}`}
          data-tone={triggerTone}
          type="button"
        >
          {triggerLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {authMethods.map((method) => (
          <DropdownMenuItem
            disabled={isConnecting}
            key={method.id}
            onSelect={() => onConnect(method)}
          >
            {isConnecting && connectingMethodId === method.id ? (
              <Spinner aria-hidden className="h-4 w-4 border-2" />
            ) : null}
            {method.name || method.id}
          </DropdownMenuItem>
        ))}
        {runtime.nodeRequired ? (
          <DropdownMenuItem onSelect={() => void openUrl("https://nodejs.org")}>
            <ExternalLink className="h-4 w-4" />
            Install Node.js
          </DropdownMenuItem>
        ) : null}
        {hasInstructions ? (
          <DropdownMenuItem
            onSelect={() => void openUrl(runtime.installInstructionsUrl)}
          >
            <ExternalLink className="h-4 w-4" />
            {runtimeInstallGuideLabel(runtime)}
          </DropdownMenuItem>
        ) : null}
        {onEdit ? (
          <DropdownMenuItem
            data-testid={`custom-harness-edit-${runtime.id}`}
            onSelect={onEdit}
          >
            Edit
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            data-testid={`custom-harness-delete-${runtime.id}`}
            onSelect={onDelete}
          >
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuntimeActions({
  authMethods,
  connectingMethodId,
  isConnecting,
  isInstalling,
  onConnect,
  onDelete,
  onEdit,
  onInstall,
  runtime,
}: {
  authMethods: AcpAuthMethod[];
  connectingMethodId: string | null;
  isConnecting: boolean;
  isInstalling: boolean;
  onConnect: (method: AcpAuthMethod) => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onInstall: () => void;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const isAvailable = runtime.availability === "available";
  // Signed-out rows carry the amber "Sign-in needed" status chip instead of a
  // green Ready chip — auth-required is an explicit row-face state, and Ready
  // must not claim otherwise.
  const isAuthNeeded =
    isAvailable && runtime.authStatus.status === "logged_out";
  const canInstall = runtime.canAutoInstall && !runtime.nodeRequired;
  const isWorking = isInstalling || isConnecting;

  const triggerLabel = isAuthNeeded
    ? "Sign in"
    : isAvailable && runtime.authStatus.status === "not_applicable"
      ? "Set up"
      : "Manage";
  return (
    <div className="cs-harness-actions">
      {isWorking ? (
        <div className="flex h-10 w-9 items-center justify-center text-muted-foreground">
          <Spinner
            aria-label={`${runtime.label} ${isInstalling ? "installing" : "connecting"}`}
            className="h-4 w-4 border-2"
            data-testid={`doctor-runtime-loading-${runtime.id}`}
          />
        </div>
      ) : !isAvailable && canInstall ? (
        // One-click installs get the button; the menu beside it keeps the
        // setup guide reachable. Rows needing multi-step setup render no
        // install here: that lives in the Add-harness catalog.
        <>
          <RuntimeOverflowMenu
            authMethods={authMethods}
            connectingMethodId={connectingMethodId}
            isConnecting={isConnecting}
            onConnect={onConnect}
            onDelete={onDelete}
            onEdit={onEdit}
            runtime={runtime}
            triggerLabel={triggerLabel}
          />
          <button
            aria-label={`Install ${runtime.label}`}
            className="cs-button cs-harness-action"
            data-testid={`doctor-runtime-install-${runtime.id}`}
            onClick={onInstall}
            type="button"
          >
            {runtime.availability === "adapter_outdated" ? "Update" : "Install"}
          </button>
        </>
      ) : (
        <RuntimeOverflowMenu
          authMethods={authMethods}
          connectingMethodId={connectingMethodId}
          isConnecting={isConnecting}
          onConnect={onConnect}
          onDelete={onDelete}
          onEdit={onEdit}
          runtime={runtime}
          triggerLabel={triggerLabel}
          triggerTone={isAuthNeeded ? "primary" : undefined}
        />
      )}
    </div>
  );
}

/** The line under a harness name: what is installed and how it signs in. */
function runtimeDescription(runtime: AcpRuntimeCatalogEntry): string {
  if (runtime.availability !== "available") {
    return entryStatusLabel(runtime) || "Not installed";
  }
  switch (runtime.authStatus.status) {
    case "logged_in":
      return "Installed \u00b7 signed in";
    case "logged_out":
      return "Installed \u00b7 not signed in yet";
    case "not_applicable":
      return runtime.id === "buzz-agent"
        ? "Built in \u00b7 runs on OpenRouter or Colony credits"
        : "Installed";
    default:
      return "Installed";
  }
}

function RuntimeStatusChip({ runtime }: { runtime: AcpRuntimeCatalogEntry }) {
  // One availability to label source: entryStatusLabel drives this row chip
  // and the catalog detail chip, so the two surfaces cannot drift.
  const isConfigError = runtime.authStatus.status === "config_invalid";
  const isAvailable = runtime.availability === "available";
  const isAuthNeeded =
    !isConfigError && isAvailable && runtime.authStatus.status === "logged_out";
  const isSignedIn = isAvailable && runtime.authStatus.status === "logged_in";
  const isUnconfigured =
    isAvailable && runtime.authStatus.status === "not_applicable";
  // Installed, and nothing to sign in to or check: the old Ready chip.
  const isReadyWithoutSignIn =
    isAvailable && runtime.authStatus.status === "unknown";

  if (isConfigError) {
    return (
      <span
        className="cs-badge cs-badge-large"
        data-testid={`doctor-runtime-status-${runtime.id}`}
        data-tone="bad"
      >
        Config error
      </span>
    );
  }
  if (isAuthNeeded) {
    return (
      <span
        className="cs-badge cs-badge-large"
        data-testid={`doctor-runtime-status-${runtime.id}`}
        data-tone="need"
      >
        Sign-in needed
      </span>
    );
  }
  if (isSignedIn) {
    return (
      <span
        className="cs-badge cs-badge-large"
        data-testid={`doctor-runtime-ready-${runtime.id}`}
        data-tone="ok"
      >
        Signed in
      </span>
    );
  }
  if (isUnconfigured || isReadyWithoutSignIn) {
    return (
      <span
        className="cs-badge cs-badge-large"
        data-testid={`doctor-runtime-ready-${runtime.id}`}
      >
        Ready
      </span>
    );
  }
  const label = entryStatusLabel(runtime);
  if (!label) return null;
  return (
    <span
      className="cs-badge cs-badge-large"
      data-testid={`doctor-runtime-status-${runtime.id}`}
    >
      {label}
    </span>
  );
}

/**
 * One row in "Your runtimes".
 *
 * Carries the full operational surface for a ready (or one-click-ready)
 * harness: logo, status chip, auth/overflow menu, install/connect flows, and
 * — for custom harnesses — edit and delete with the blast-radius guard.
 */
export function HarnessRow({
  embedded = false,
  resetEpoch,
  runtime,
}: {
  embedded?: boolean;
  resetEpoch: number;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const isCustom = runtime.source === "custom";
  const [terminalLaunchMethodId, setTerminalLaunchMethodId] = React.useState<
    string | null
  >(null);
  const [isUpdateWarningOpen, setIsUpdateWarningOpen] = React.useState(false);
  const [isInstallConfirmationOpen, setIsInstallConfirmationOpen] =
    React.useState(false);
  const [installProgressDismissed, setInstallProgressDismissed] =
    React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  // Each row owns its mutation instance so concurrent installs each track
  // their own isPending / result state independently.
  const installMutation = useInstallAcpRuntimeMutation();
  const [installResult, setInstallResult] = React.useState<{
    success: boolean;
    error: string | null;
  } | null>(null);
  // Clear stale install results when the parent triggers a catalog refresh
  // (Check again) — the runtime may now be healthy and stale failure state
  // would linger because keyed rows don't remount on refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetEpoch is an intentional trigger only; its value is not consumed in the effect body
  React.useEffect(() => {
    setInstallResult(null);
  }, [resetEpoch]);
  const isInstalling = installMutation.isPending;
  const installError = installResult?.error ?? null;
  const installOutputLine = useInstallOutputLine(runtime.id, isInstalling);

  const del = useDeleteCustomHarnessMutation();
  // Blast-radius data for the delete confirmation — only fetched while the
  // confirmation is open, so the row list doesn't poll agents. Confirm stays
  // disabled until both queries settle (deleteConfirmState) so a quick click
  // can't beat the "N agents will stop launching" warning.
  const agentsQuery = useManagedAgentsQuery({ enabled: confirmingDelete });
  const personasQuery = usePersonasQuery({ enabled: confirmingDelete });
  const confirmState = deleteConfirmState(
    runtime.id,
    runtime.label,
    agentsQuery,
    personasQuery,
  );

  function handleInstall() {
    setInstallProgressDismissed(false);
    setInstallResult(null);
    installMutation.mutate(runtime.id, {
      onSuccess: (result) => {
        if (result.success) {
          setInstallResult({ success: true, error: null });
        } else {
          setInstallResult({
            success: false,
            error: getInstallErrorMessage(result),
          });
        }
      },
      onError: (error) => {
        setInstallResult({
          success: false,
          error: error instanceof Error ? error.message : "Install failed.",
        });
      },
    });
  }

  const canConnectAccount =
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out";
  const authMethodsQuery = useAcpAuthMethodsQuery(runtime.id, {
    enabled: canConnectAccount,
  });
  const authMethods = canConnectAccount
    ? (authMethodsQuery.data?.methods ?? [])
    : [];
  const connectMutation = useConnectAcpRuntimeMutation();
  const connectionError = connectMutation.error
    ? `Couldn't connect ${runtime.label}: ${
        connectMutation.error instanceof Error
          ? connectMutation.error.message
          : "Connection failed."
      }`
    : authMethodsQuery.error
      ? `Couldn't load sign-in options: ${
          authMethodsQuery.error instanceof Error
            ? authMethodsQuery.error.message
            : "Request failed."
        }`
      : null;

  if (editing) {
    return (
      <CustomHarnessForm
        initial={formValuesFromCatalogEntry(runtime)}
        originalId={runtime.id}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className={cn(
        "cs-harness-row",
        !embedded && "rounded-2xl border border-border/60 bg-muted/20",
      )}
      data-testid={`doctor-runtime-${runtime.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="cs-harness-main">
          <RuntimeLogo runtime={runtime} />
          <span className="cs-harness-copy">
            <strong>{runtime.label}</strong>
            <span>{runtimeDescription(runtime)}</span>
          </span>
          <RuntimeStatusChip runtime={runtime} />
          <RuntimeActions
            authMethods={authMethods}
            connectingMethodId={connectMutation.variables?.methodId ?? null}
            isConnecting={connectMutation.isPending}
            isInstalling={isInstalling}
            onConnect={(method) => {
              setTerminalLaunchMethodId(null);
              connectMutation.mutate(
                {
                  runtimeId: runtime.id,
                  methodId: method.id,
                },
                {
                  onSuccess: (result) => {
                    if (result.launched && method.type === "terminal") {
                      setTerminalLaunchMethodId(method.id);
                    }
                  },
                },
              );
            }}
            onDelete={
              isCustom
                ? () => {
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  }
                : undefined
            }
            onEdit={isCustom ? () => setEditing(true) : undefined}
            onInstall={() => {
              if (runtime.availability === "adapter_outdated") {
                setIsUpdateWarningOpen(true);
                return;
              }
              setIsInstallConfirmationOpen(true);
            }}
            runtime={runtime}
          />
        </div>

        {runtime.authStatus.status === "config_invalid" ? (
          <p
            className="mt-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            data-testid={`doctor-runtime-config-error-${runtime.id}`}
          >
            Config error: {runtime.authStatus.diagnostic}
          </p>
        ) : null}

        {isInstalling && installOutputLine ? (
          <p
            aria-live="polite"
            className="mt-2 truncate rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 font-mono text-xs text-muted-foreground"
            data-testid={`doctor-runtime-install-output-${runtime.id}`}
          >
            {installOutputLine}
          </p>
        ) : null}
        {connectionError ? (
          <p
            className="mt-2 whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
            data-testid={`doctor-runtime-error-${runtime.id}`}
          >
            {connectionError}
          </p>
        ) : null}
        {canConnectAccount && terminalLaunchMethodId ? (
          <p
            className="mt-2 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm text-muted-foreground"
            data-testid={`doctor-runtime-terminal-guidance-${runtime.id}`}
          >
            Finish signing in from the Terminal window, then click Check again
            to re-check {runtime.label}.
          </p>
        ) : null}
        {confirmingDelete ? (
          <div className="mt-2 space-y-2">
            <p
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400"
              data-testid={`custom-harness-delete-warning-${runtime.id}`}
            >
              {confirmState.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                className="h-7 px-3 text-xs"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-7 px-3 text-xs"
                data-testid={`custom-harness-delete-confirm-${runtime.id}`}
                disabled={del.isPending || !confirmState.canConfirm}
                onClick={() => {
                  setDeleteError(null);
                  del.mutate(runtime.id, {
                    onSuccess: () => setConfirmingDelete(false),
                    onError: (err) => {
                      setDeleteError(
                        err instanceof Error ? err.message : String(err),
                      );
                      // Keep confirmation open so user sees the error.
                    },
                  });
                }}
                size="sm"
                type="button"
                variant="destructive"
              >
                {del.isPending ? <Spinner className="h-3.5 w-3.5" /> : "Delete"}
              </Button>
            </div>
          </div>
        ) : null}
        {deleteError ? (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </div>
      <AlertDialog
        onOpenChange={setIsUpdateWarningOpen}
        open={isUpdateWarningOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update {runtime.label} adapter?</AlertDialogTitle>
            <AlertDialogDescription>
              {adapterUpdateWarning(runtime)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleInstall}
              data-testid={`doctor-runtime-confirm-update-${runtime.id}`}
            >
              Update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <HarnessInstallDialog
        installOutputLine={installOutputLine}
        onConfirm={() => {
          setIsInstallConfirmationOpen(false);
          handleInstall();
        }}
        onOpenChange={(open) => {
          if (isInstalling) {
            setInstallProgressDismissed(!open);
          } else {
            setIsInstallConfirmationOpen(open);
          }
        }}
        open={
          isInstallConfirmationOpen ||
          (isInstalling && !installProgressDismissed)
        }
        runtime={runtime}
        stage={isInstalling ? "installing" : "confirm"}
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setInstallResult(null);
        }}
        open={installError !== null}
      >
        <SettingsAlertDialogContent
          className="flex w-[33.75rem] max-w-[calc(100vw-2rem)] max-h-[90vh] flex-col gap-0 overflow-hidden rounded-[0.75rem] border border-[#eae7eb] bg-[#fffefd] p-0 text-[#282532] shadow-[0_24px_80px_#30203824] dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
          data-testid={`doctor-runtime-install-failure-${runtime.id}`}
        >
          <div className="flex items-center justify-between border-b border-[#eae7eb] px-[1.5625rem] pt-[1.4375rem] pb-6 dark:border-[#3c3544]">
            <AlertDialogHeader className="space-y-0">
              <AlertDialogTitle className="text-lg font-medium tracking-normal">
                Failed
              </AlertDialogTitle>
            </AlertDialogHeader>
            <Button
              aria-label="Close"
              data-testid={`doctor-runtime-install-close-${runtime.id}`}
              onClick={() => setInstallResult(null)}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div className="flex flex-col px-[1.5625rem] pt-[1.4375rem] pb-[3.0625rem]">
            <div className="mb-[1.1875rem] space-y-1 rounded-[7px] border border-[#edd8dd] bg-[#fcf2f4] px-[1.125rem] py-[1.03125rem] text-xs leading-5 text-[#925369] dark:border-[#63414e] dark:bg-[#402b34] dark:text-[#dcacb8]">
              <p className="font-semibold">
                {runtime.label} could not be installed.
              </p>
              <AlertDialogDescription className="whitespace-pre-line text-xs text-[#925369] dark:text-[#dcacb8]">
                {installError
                  ?.split("\n\nFull log:")[0]
                  .replace(/^Step "[^"]+" failed:\s*/, "")}{" "}
                Other harnesses are unaffected.
              </AlertDialogDescription>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-[#282532] dark:text-[#e6e1ec]">
                Show details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-2xs text-[#79747f] dark:text-[#a9a1b4]">
                {installError}
              </pre>
            </details>
          </div>
          <AlertDialogFooter className="flex-row border-t border-[#eae7eb] px-[1.5625rem] py-[1.125rem] dark:border-[#3c3544]">
            <AlertDialogCancel className="h-9 rounded-md border-[#eae7eb] bg-transparent px-[13px] text-xs font-semibold text-[#282532] hover:bg-[#f4f0f7] dark:border-[#3c3544] dark:text-[#e6e1ec] dark:hover:bg-[#3a3243]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-md bg-[#2655a0] px-[13px] text-xs font-semibold text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
              data-testid={`doctor-runtime-install-retry-${runtime.id}`}
              onClick={handleInstall}
            >
              Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </SettingsAlertDialogContent>
      </AlertDialog>
    </div>
  );
}
