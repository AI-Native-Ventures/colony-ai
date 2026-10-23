import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ChevronRight,
  Info,
  MessageSquare,
  RefreshCw,
  ScrollText,
} from "lucide-react";

import type { IdentityArchiveActions } from "@/features/identity-archive/hooks";
import type { ManagedAgent, RestartDiffEntry } from "@/shared/api/types";
import {
  AUTO_RESTART_OFF_BLURB,
  AUTO_RESTART_ON_BLURB,
  RestartDiffList,
} from "@/features/agents/ui/RestartDiffBadge";
import { UserProfileAgentManagementRows } from "@/features/profile/ui/UserProfileAgentManagementRows";
import { ProtectedAgentBestieAction } from "@protected-feature-components";
import { ProfileInstancesSection } from "@/features/profile/ui/ProfileInstancesSection";
import {
  type ProfileField,
  ProfileFieldRows,
  ProfileSectionGroup,
} from "@/features/profile/ui/UserProfilePanelFields";
import type { ProfilePanelTab } from "@/features/profile/ui/UserProfilePanelUtils";
import { cn } from "@/shared/lib/cn";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export function ProfileIngressRow({
  disabled,
  disclosureIcon: DisclosureIcon = ChevronRight,
  grouped = false,
  icon: Icon,
  label,
  onClick,
  testId,
  trailing,
}: {
  disabled?: boolean;
  disclosureIcon?: LucideIcon;
  grouped?: boolean;
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  testId: string;
  trailing?: React.ReactNode;
}) {
  const trailingTitle = typeof trailing === "string" ? trailing : undefined;

  const content = (
    <>
      {Icon ? (
        <Icon
          className="h-4 w-4 shrink-0 text-muted-foreground"
          data-slot="profile-ingress-icon"
        />
      ) : null}
      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {label}
      </span>
      {trailing ? (
        <span
          className="max-w-[45%] truncate text-right text-sm text-muted-foreground"
          title={trailingTitle}
        >
          {trailing}
        </span>
      ) : null}
      {onClick ? (
        <DisclosureIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  const className = cn(
    "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left",
    onClick &&
      "transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
  );

  let row: React.ReactNode;
  if (!onClick) {
    row = (
      <div className={className} data-testid={testId}>
        {content}
      </div>
    );
  } else {
    row = (
      <button
        className={cn(
          className,
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return grouped ? (
    row
  ) : (
    <PanelSectionGroup testId={`${testId}-section`}>{row}</PanelSectionGroup>
  );
}

export function ProfileTabBar({
  activeTab,
  onTabChange,
  tabs,
}: {
  activeTab: ProfilePanelTab;
  onTabChange: (tab: ProfilePanelTab) => void;
  tabs: Array<{
    id: ProfilePanelTab;
    label: string;
    trailing?: React.ReactNode;
  }>;
}) {
  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  );

  return (
    <Tabs
      className="w-full"
      onValueChange={(value) => onTabChange(value as ProfilePanelTab)}
      value={activeTab}
    >
      <TabsList
        aria-label="Profile sections"
        className="relative isolate grid h-9 w-full overflow-hidden rounded-lg bg-muted p-0.5"
        data-testid="user-profile-tab-list"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute bottom-0.5 left-0.5 top-0.5 z-0 rounded-md bg-background shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          data-testid="user-profile-tab-indicator"
          style={{
            transform: `translateX(${activeIndex * 100}%)`,
            width: `calc((100% - 4px) / ${tabs.length})`,
          }}
        />
        {tabs.map((tab) => {
          return (
            <TabsTrigger
              className="group relative z-10 h-full min-w-0 gap-1 rounded-md bg-transparent px-2 text-xs font-medium shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              data-testid={`user-profile-tab-${tab.id}`}
              key={tab.id}
              value={tab.id}
            >
              <span className="truncate">{tab.label}</span>
              {tab.trailing ? (
                <span className="inline-flex shrink-0 items-center leading-none text-2xs text-muted-foreground group-data-[state=active]:text-foreground/70">
                  {tab.trailing}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export function ProfileInfoTabContent({
  agentInfoFields,
  archiveActions,
  canArchiveAgent,
  canDeleteAgent,
  isArchived,
  isDeleteAgentPending,
  managedAgent,
  onCreateCard,
  onDeleteAgent,
  onDuplicateAgent,
  onExportAgent,
  onEditAgent,
  showInstructionBlock,
}: {
  agentInfoFields: ProfileField[];
  archiveActions: IdentityArchiveActions;
  canArchiveAgent: boolean;
  canDeleteAgent: boolean;
  isArchived: boolean;
  isDeleteAgentPending: boolean;
  managedAgent?: ManagedAgent;
  /** Mint an agent trading card. Present only for owner-managed personas. */
  onCreateCard?: () => void;
  onDeleteAgent: () => void;
  onDuplicateAgent?: () => void;
  onExportAgent?: () => void;
  onEditAgent: () => void;
  showInstructionBlock: boolean;
}) {
  const infoFields: ProfileField[] = isArchived
    ? [
        ...agentInfoFields,
        {
          displayValue: "Archived",
          icon: Archive,
          label: "Visibility",
          testId: "user-profile-archived-flair",
          trailingNode: <ArchiveStatusTooltip />,
        },
      ]
    : agentInfoFields;
  const hasInfoFields = infoFields.length > 0;
  const showArchiveAction =
    canArchiveAgent && archiveActions.isArchived !== undefined;

  if (
    !hasInfoFields &&
    !showArchiveAction &&
    !canDeleteAgent &&
    !onCreateCard &&
    !onDuplicateAgent &&
    !onExportAgent &&
    !showInstructionBlock
  ) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="user-profile-info-sections">
      {hasInfoFields || showInstructionBlock ? (
        <ProfileSectionGroup testId="user-profile-info-section" title="Info">
          {showInstructionBlock ? (
            <ProfileIngressRow
              grouped
              icon={MessageSquare}
              label="Agent instructions"
              onClick={onEditAgent}
              testId="user-profile-agent-instruction-row"
            />
          ) : null}
          <ProfileFieldRows fields={infoFields} />
        </ProfileSectionGroup>
      ) : null}
      <UserProfileAgentManagementRows
        archiveActions={archiveActions}
        canArchiveAgent={showArchiveAction}
        canDeleteAgent={canDeleteAgent}
        isDeletePending={isDeleteAgentPending}
        managedAgent={managedAgent}
        onCreateCard={onCreateCard}
        onDeleteAgent={onDeleteAgent}
        onDuplicateAgent={onDuplicateAgent}
        onExportAgent={onExportAgent}
        supplementalAction={
          managedAgent ? (
            <ProtectedAgentBestieAction agent={managedAgent} />
          ) : null
        }
      />
    </div>
  );
}

function ArchiveStatusTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="What archived means"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="user-profile-archived-info"
          type="button"
        >
          <Info className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-72 text-left" side="top">
        <p className="text-sm">
          Archived agents do not appear in search, autocomplete, or member-add
          flows in this space. You can unarchive them at any time.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function ProfileRuntimeTabContent({
  autoRestartEnabled = false,
  archivedInstances,
  currentPubkey,
  diagnosticsFields,
  diagnosticsSummary,
  configurationFields,
  instances,
  modelSettings,
  needsRestart = false,
  restartDiff = [],
  startOnLaunchEnabled,
  startOnLaunchPending = false,
  onOpenDiagnostics,
  onOpenInstance,
  onToggleStartOnLaunch,
  showDiagnosticsIngress,
}: {
  /** Whether the per-agent auto-restart toggle is ON. */
  autoRestartEnabled?: boolean;
  archivedInstances: ManagedAgent[];
  currentPubkey: string | null;
  diagnosticsFields: ProfileField[];
  diagnosticsSummary: React.ReactNode;
  configurationFields: ProfileField[];
  instances: ManagedAgent[];
  modelSettings?: React.ReactNode;
  /** True when the running agent's config has drifted from what it was spawned with. */
  needsRestart?: boolean;
  /** The full itemised diff — shown uncapped in the Runtime banner. */
  restartDiff?: RestartDiffEntry[];
  startOnLaunchEnabled?: boolean;
  startOnLaunchPending?: boolean;
  onOpenDiagnostics: () => void;
  onOpenInstance: (pubkey: string) => void;
  onToggleStartOnLaunch?: () => void;
  showDiagnosticsIngress: boolean;
}) {
  const startOnLaunchFieldIndex = configurationFields.findIndex(
    (field) => field.label === "Start on launch",
  );
  const startOnLaunchField = configurationFields[startOnLaunchFieldIndex];
  const StartOnLaunchIcon = startOnLaunchField?.icon;
  const remainingConfigurationFields = configurationFields.filter(
    (_, index) => index !== startOnLaunchFieldIndex,
  );
  const resolvedStartOnLaunchEnabled =
    startOnLaunchEnabled ?? startOnLaunchField?.displayValue === "Yes";
  const canToggleStartOnLaunch = onToggleStartOnLaunch !== undefined;
  const handleStartOnLaunchToggle = React.useCallback(() => {
    if (startOnLaunchPending) return;
    onToggleStartOnLaunch?.();
  }, [onToggleStartOnLaunch, startOnLaunchPending]);
  const statusDiagnosticsFields = diagnosticsFields.filter(
    (field) => field.label === "Status",
  );
  const hasActivityRows =
    statusDiagnosticsFields.length > 0 ||
    startOnLaunchField !== undefined ||
    showDiagnosticsIngress;
  const hasConfigurationRows = remainingConfigurationFields.length > 0;
  const hasInstances = instances.length > 0 || archivedInstances.length > 0;

  if (
    statusDiagnosticsFields.length === 0 &&
    !hasActivityRows &&
    !hasConfigurationRows &&
    !modelSettings &&
    !hasInstances &&
    !needsRestart
  ) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="user-profile-runtime-sections">
      {needsRestart ? (
        <div
          className="flex items-start gap-3 rounded-2xl bg-amber-500/10 px-4 py-3"
          data-testid="needs-restart-banner"
        >
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              Restart required
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {autoRestartEnabled
                ? AUTO_RESTART_ON_BLURB
                : AUTO_RESTART_OFF_BLURB}
            </p>
            {/* Full uncapped diff list — Runtime banner is the only surface
                where all entries show without truncation. */}
            <RestartDiffList restartDiff={restartDiff} />
          </div>
        </div>
      ) : null}
      {hasActivityRows ? (
        <ProfileSectionGroup
          testId="user-profile-runtime-activity-section"
          title="Activity"
        >
          {statusDiagnosticsFields.length > 0 ? (
            <ProfileFieldRows
              fields={statusDiagnosticsFields}
              variant="runtime"
            />
          ) : null}
          {startOnLaunchField ? (
            <div
              aria-checked={resolvedStartOnLaunchEnabled}
              aria-disabled={!canToggleStartOnLaunch || startOnLaunchPending}
              aria-label={startOnLaunchField.label}
              className={cn(
                "flex min-h-16 items-center gap-3 px-4 py-3",
                canToggleStartOnLaunch &&
                  "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
              data-testid={startOnLaunchField.testId}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                handleStartOnLaunchToggle();
              }}
              onClick={
                canToggleStartOnLaunch ? handleStartOnLaunchToggle : undefined
              }
              role="switch"
              tabIndex={canToggleStartOnLaunch ? 0 : -1}
            >
              {StartOnLaunchIcon ? (
                <StartOnLaunchIcon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  data-slot="profile-field-icon"
                />
              ) : null}
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {startOnLaunchField.label}
              </span>
              <Switch
                aria-hidden="true"
                checked={resolvedStartOnLaunchEnabled}
                data-testid={`${startOnLaunchField.testId}-toggle`}
                disabled={!canToggleStartOnLaunch || startOnLaunchPending}
                tabIndex={-1}
              />
            </div>
          ) : null}
          {showDiagnosticsIngress ? (
            <ProfileIngressRow
              grouped
              icon={ScrollText}
              label="Harness log"
              onClick={onOpenDiagnostics}
              testId="user-profile-diagnostics-ingress"
              trailing={diagnosticsSummary}
            />
          ) : null}
        </ProfileSectionGroup>
      ) : null}
      {hasConfigurationRows ? (
        <ProfileSectionGroup
          testId="user-profile-agent-configuration-section"
          title="Agent configuration"
        >
          <ProfileFieldRows
            fields={remainingConfigurationFields}
            variant="runtime"
          />
        </ProfileSectionGroup>
      ) : null}
      {modelSettings}
      {hasInstances ? (
        <ProfileInstancesSection
          archivedInstances={archivedInstances}
          currentPubkey={currentPubkey}
          instances={instances}
          onOpenInstance={onOpenInstance}
        />
      ) : null}
    </div>
  );
}
