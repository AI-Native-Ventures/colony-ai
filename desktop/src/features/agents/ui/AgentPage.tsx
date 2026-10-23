import * as React from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useIsManagedAgent } from "@/features/agent-memory/hooks";
import { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import {
  useAcpRuntimesQuery,
  useAgentConfigSurface,
  usePersonasQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import {
  useChannelsQuery,
  useOpenDmMutation,
} from "@/features/channels/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useEmployeeRuntime } from "@/features/company-team/useEmployeeRuntime";
import {
  EditRoleReportingDialog,
  ReviewRehireDialog,
  TerminateEmployeeDialog,
} from "@/features/company-team/ui/TeamDialogs";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import type { TeamMember } from "@/features/company-team/teamModels";
import { useIdentityArchive } from "@/features/identity-archive/hooks";
import { useUserProfileQuery } from "@/features/profile/hooks";
import { ArchiveConfirmDialog } from "@/features/profile/ui/ArchiveConfirmDialog";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { AgentInstanceEditDialog } from "./AgentInstanceEditDialog";
import { AgentPageInstructions } from "./AgentPageInstructions";
import {
  AgentPageOverview,
  type AgentChannelOption,
} from "./AgentPageOverview";
import { AgentPageRuntime } from "./AgentPageRuntime";
import { AgentStatusChip } from "./AgentStatusChip";
import { useManagedAgentActions } from "./useManagedAgentActions";
import { providerName } from "./agentPageModel";
import "./agentsColony3.css";

type AgentPageOrigin = "agents" | "team";

const MESSAGE_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="17"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="17"
  >
    <path d="M4.5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h10A2.5 2.5 0 0 1 19.5 7v7a2.5 2.5 0 0 1-2.5 2.5H8z" />
  </svg>
);

const STOP_ICON = (
  <svg
    aria-hidden="true"
    fill="currentColor"
    height="15"
    viewBox="0 0 24 24"
    width="15"
  >
    <rect height="12" rx="2" width="12" x="6" y="6" />
  </svg>
);

const PLAY_ICON = (
  <svg
    aria-hidden="true"
    fill="currentColor"
    height="15"
    viewBox="0 0 24 24"
    width="15"
  >
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

const MORE_ICON = (
  <svg
    aria-hidden="true"
    fill="currentColor"
    height="18"
    viewBox="0 0 24 24"
    width="18"
  >
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </svg>
);

const INFO_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="18"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2.4"
    viewBox="0 0 24 24"
    width="18"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.2" />
  </svg>
);

function runtimeChip(label: string): { text: string; tone?: "plain" } {
  switch (label) {
    case "Ready":
    case "Working":
      // Working is a state of the work, not of the runtime: a working agent
      // has a ready runtime.
      return { text: "Runtime ready", tone: "plain" };
    case "Offline":
      return { text: "Runtime offline", tone: "plain" };
    default:
      return { text: label };
  }
}

/**
 * The one page an agent opens to (`AgentProfile.dc.html`): its header and
 * overview, then its model and runtime, then its instructions. No tabs.
 * Both `/agents?agent=<pubkey>` and `/team/detail/<pubkey>` render it.
 */
export function AgentPage({
  origin = "agents",
  pubkey,
}: {
  origin?: AgentPageOrigin;
  pubkey: string;
}) {
  const key = pubkey.toLowerCase();
  const actions = useManagedAgentActions();
  const agent = actions.managedAgents.find(
    (candidate) => candidate.pubkey.toLowerCase() === key,
  );
  const teamQuery = useCompanyTeamQuery();
  const identity = useIdentityQuery();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const configQuery = useAgentConfigSurface(agent ? agent.pubkey : null);
  const channelsQuery = useChannelsQuery({ enabled: true });
  const relayAgentsQuery = useRelayAgentsQuery({ enabled: true });
  const activeTurns = useActiveAgentTurns(key);
  const managedOwner = useIsManagedAgent(key);
  const profileQuery = useUserProfileQuery(key);
  const archive = useIdentityArchive(key);
  const openDm = useOpenDmMutation();
  const appShell = useAppShell();
  const { goAgents, goChannel, goTeam } = useAppNavigation();

  const member = teamQuery.data?.members.find(
    (candidate) => candidate.pubkey === key,
  );
  const position = member?.position?.head;
  const managerProfile = useUserProfileQuery(position?.managerPubkey);
  const ownerProfile = useUserProfileQuery(
    profileQuery.data?.ownerPubkey ?? undefined,
  );
  const viewerRole = teamQuery.data?.relayMembers.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === identity.data?.pubkey.toLowerCase(),
  )?.role;
  const canManage = viewerRole === "owner" || viewerRole === "admin";

  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [configOpen, setConfigOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<
    "edit" | "terminate" | "rehire" | null
  >(null);
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);

  const runtimes = runtimesQuery.data ?? [];
  const runtime = agent ? runtimeForAgent(agent, runtimes) : undefined;
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === agent?.personaId,
  );
  const employeeRuntime = useEmployeeRuntime(
    member ?? {
      pubkey: key,
      kind: "employee",
      createdAt: agent?.createdAt ?? new Date(0).toISOString(),
      fallbackName: agent?.name ?? null,
      role: null,
      managedAgent: agent ?? null,
      relayAgent: null,
      position: null,
    },
  );

  const relayAgent = relayAgentsQuery.data?.find(
    (candidate) => candidate.pubkey.toLowerCase() === key,
  );
  const channelOptions: AgentChannelOption[] = React.useMemo(() => {
    const ids = Array.from(
      new Set([
        ...(relayAgent?.channelIds ?? []),
        ...activeTurns.map((turn) => turn.channelId),
      ]),
    );
    return ids.map((id) => {
      const channel = channelsQuery.data?.find((entry) => entry.id === id);
      return {
        id,
        name: channel?.name ?? id.slice(0, 8),
        visibility: channel?.visibility,
      };
    });
  }, [activeTurns, channelsQuery.data, relayAgent?.channelIds]);

  const name =
    agent?.name ||
    profileQuery.data?.displayName?.trim() ||
    member?.fallbackName ||
    "Unnamed agent";
  const title =
    profileQuery.data?.jobTitle?.trim() ||
    position?.title?.trim() ||
    profileQuery.data?.about?.trim() ||
    "";
  const ownerName = ownerProfile.data?.displayName?.trim() || null;
  const managerName = managerProfile.data?.displayName?.trim() || null;
  const description = persona?.description?.trim() || null;

  const openChannel = (channelId: string) => void goChannel(channelId);
  const backToList = () => void (origin === "team" ? goTeam() : goAgents());

  async function message() {
    setOpening(true);
    setMessageError(null);
    try {
      const dm = await openDm.mutateAsync({ pubkeys: [key] });
      await goChannel(dm.id);
    } catch (error) {
      setMessageError(
        error instanceof Error ? error.message : "Could not open a message.",
      );
    } finally {
      setOpening(false);
    }
  }

  const trail = (
    <AppTopChromePortal>
      <nav
        aria-label="Breadcrumb"
        className="agents-c3-trail"
        data-testid="agent-page-breadcrumb"
      >
        <span>Company</span>
        <span aria-hidden="true">/</span>
        <button onClick={backToList} type="button">
          {origin === "team" ? "Team" : "Agents"}
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{name}</span>
      </nav>
    </AppTopChromePortal>
  );

  if (!agent) {
    const loading = actions.managedAgentsQuery.isLoading;
    return (
      <div
        className="agents-c3 h-full min-h-0 w-full flex-1 overflow-y-auto"
        data-testid="agent-profile"
      >
        <div className="agents-c3-page" data-kind="profile">
          {trail}
          {loading ? (
            <p className="agents-c3-quiet">Loading agent…</p>
          ) : member ? (
            <>
              <div className="agents-c3-hero">
                <EmployeeAvatar
                  className="agents-c3-hero-avatar"
                  name={name}
                  profile={profileQuery.data?.avatarUrl}
                />
                <div className="agents-c3-hero-text">
                  <h1 className="agents-c3-title">{name}</h1>
                  {title ? (
                    <span className="agents-c3-hero-line">{title}</span>
                  ) : null}
                  <div className="agents-c3-hero-meta">
                    <span>AI employee</span>
                  </div>
                </div>
                <div className="agents-c3-hero-actions">
                  <button
                    className="agents-c3-btn"
                    data-size="md"
                    data-variant="primary"
                    disabled={opening}
                    onClick={() => void message()}
                    type="button"
                  >
                    {MESSAGE_ICON}
                    {opening ? "Opening…" : "Message"}
                  </button>
                </div>
              </div>
              {messageError ? (
                <p className="agents-c3-error" role="alert">
                  {messageError}
                </p>
              ) : null}
              <section className="agents-c3-card" data-testid="agent-unlinked">
                <h2 className="agents-c3-eyebrow">Not on this device</h2>
                <p className="agents-c3-body">
                  {name} does not run on this device. Its model and instructions
                  can be changed from the device that runs it.
                </p>
              </section>
            </>
          ) : (
            <div className="agents-c3-card">
              <p className="agents-c3-strong">Agent not found.</p>
              <div>
                <button
                  className="agents-c3-btn"
                  data-size="md"
                  onClick={backToList}
                  type="button"
                >
                  {origin === "team" ? "Back to team" : "Back to directory"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const running = isManagedAgentActive(agent);
  const local = agent.backend.type === "local";
  const runtimeText = runtimeChip(employeeRuntime.label);
  const availability = runtimesQuery.isLoading
    ? "loading"
    : runtimesQuery.isError
      ? "error"
      : runtime
        ? runtime.availability
        : "unknown";
  const positionChip =
    position?.status === "terminated"
      ? { label: "Terminated", tone: "offline" as const }
      : position?.status === "paused"
        ? { label: "Paused", tone: "needs" as const }
        : position
          ? { label: "Active", tone: "ready" as const }
          : null;

  return (
    <div
      className="agents-c3 h-full min-h-0 w-full flex-1 overflow-y-auto"
      data-testid="agent-profile"
    >
      <div className="agents-c3-page" data-kind="profile">
        {trail}
        <div className="agents-c3-hero">
          <EmployeeAvatar
            className="agents-c3-hero-avatar"
            definition={persona?.avatarUrl}
            instance={agent.avatarUrl}
            name={agent.name}
            personaId={agent.personaId}
            profile={profileQuery.data?.avatarUrl}
            testId="agent-profile-avatar"
          />
          <div className="agents-c3-hero-text">
            <h1 className="agents-c3-title">{agent.name || "Unnamed agent"}</h1>
            {title || ownerName ? (
              <span className="agents-c3-hero-line">
                {title}
                {title && ownerName ? " · " : ""}
                {ownerName ? `managed by ${ownerName}` : ""}
              </span>
            ) : null}
            <div className="agents-c3-hero-meta">
              <span data-testid="company-position-header">
                AI employee{managerName ? ` · Reports to ${managerName}` : ""}
              </span>
              {positionChip ? (
                <AgentStatusChip
                  label={positionChip.label}
                  size="sm"
                  tone={positionChip.tone}
                />
              ) : null}
              {archive.isArchived ? (
                <AgentStatusChip label="Archived" size="sm" />
              ) : null}
              <AgentStatusChip
                label={runtimeText.text}
                size="sm"
                tone={runtimeText.tone}
              />
            </div>
          </div>
          <div className="agents-c3-hero-actions">
            <button
              className="agents-c3-btn"
              data-size="md"
              data-variant="primary"
              disabled={opening}
              onClick={() => void message()}
              type="button"
            >
              {MESSAGE_ICON}
              {opening ? "Opening…" : "Message"}
            </button>
            {running || !local ? (
              <button
                className="agents-c3-btn"
                data-size="md"
                disabled={!running || actions.isPending}
                onClick={() => void actions.handleStop(agent.pubkey)}
                type="button"
              >
                {STOP_ICON}
                Stop agent
              </button>
            ) : (
              <button
                className="agents-c3-btn"
                data-size="md"
                disabled={actions.isPending}
                onClick={() => void actions.handleStart(agent.pubkey)}
                type="button"
              >
                {PLAY_ICON}
                Start agent
              </button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-haspopup="menu"
                  aria-label="More agent actions"
                  className="agents-c3-btn"
                  data-size="icon"
                  type="button"
                >
                  {MORE_ICON}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canManage && member ? (
                  <DropdownMenuItem onSelect={() => setDialog("edit")}>
                    Edit role and reporting
                  </DropdownMenuItem>
                ) : null}
                {canManage && member && position?.status === "active" ? (
                  <DropdownMenuItem onSelect={() => setDialog("terminate")}>
                    Terminate employee
                  </DropdownMenuItem>
                ) : null}
                {canManage && member && position?.status === "terminated" ? (
                  <DropdownMenuItem onSelect={() => setDialog("rehire")}>
                    Review rehire
                  </DropdownMenuItem>
                ) : null}
                {archive.canArchive && archive.isArchived !== undefined ? (
                  <DropdownMenuItem
                    disabled={archive.isPending}
                    onSelect={() =>
                      archive.isArchived
                        ? void archive.unarchive()
                        : setArchiveOpen(true)
                    }
                  >
                    {archive.isArchived ? "Unarchive agent" : "Archive agent"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {messageError ? (
          <p className="agents-c3-error" role="alert">
            {messageError}
          </p>
        ) : null}

        {position?.status === "paused" ? (
          <div
            className="agents-c3-banner"
            data-testid="company-paused-banner"
            data-tone="paused"
            role="status"
          >
            <span>Paused · {position.reason}</span>
          </div>
        ) : null}
        {position?.status === "terminated" ? (
          <div
            className="agents-c3-banner"
            data-testid="company-terminated-banner"
            data-tone="bad"
            role="status"
          >
            <span>Terminated · {position.reason}</span>
            {canManage && member && running ? (
              <button onClick={() => setDialog("terminate")} type="button">
                Retry stopping runtime
              </button>
            ) : null}
            {canManage && member ? (
              <button onClick={() => setDialog("rehire")} type="button">
                Review rehire
              </button>
            ) : null}
          </div>
        ) : null}
        {agent.needsRestart ? (
          <div className="agents-c3-banner" role="status">
            {INFO_ICON}
            <span>Saved changes apply on the next start.</span>
            {local ? (
              <button
                disabled={actions.isPending}
                onClick={() => void actions.handleRestart(agent.pubkey)}
                type="button"
              >
                Restart agent
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className="agents-c3-stack"
          data-testid="agent-profile-content"
        >
          <AgentPageOverview
            activeTurns={activeTurns}
            agent={agent}
            channelError={
              channelsQuery.error instanceof Error
                ? channelsQuery.error
                : relayAgentsQuery.error instanceof Error
                  ? relayAgentsQuery.error
                  : null
            }
            channelOptions={channelOptions}
            channelsLoading={
              channelsQuery.isLoading || relayAgentsQuery.isLoading
            }
            description={description}
            harnessLabel={runtime?.label ?? "Not reported"}
            onOpenChannel={openChannel}
            providerLabel={
              agent.provider ? providerName(agent.provider) : "Not reported"
            }
          />
          <AgentPageRuntime
            agent={agent}
            authStatus={runtime?.authStatus.status ?? "unknown"}
            availability={availability}
            canEdit={managedOwner !== false}
            config={configQuery.data}
            configError={
              configQuery.error instanceof Error ? configQuery.error : null
            }
            configLoading={configQuery.isLoading}
            onEditConfiguration={() => setConfigOpen(true)}
            onManageHarnesses={() => appShell.onOpenSettings?.("agents")}
            runtime={runtime}
          />
          <AgentPageInstructions
            agent={agent}
            canEdit={managedOwner !== false}
            instruction={agent.systemPrompt ?? persona?.systemPrompt ?? null}
            key={agent.pubkey}
            ownerName={ownerName}
            persona={persona}
          />
        </div>
      </div>

      <AgentInstanceEditDialog
        agent={agent}
        onOpenChange={setConfigOpen}
        open={configOpen}
      />
      <ArchiveConfirmDialog
        isBot
        isPending={archive.isPending}
        onConfirm={archive.archive}
        onOpenChange={setArchiveOpen}
        open={archiveOpen}
      />
      {member ? (
        <PageDialogs
          dialog={dialog}
          member={member}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function PageDialogs({
  dialog,
  member,
  onClose,
}: {
  dialog: "edit" | "terminate" | "rehire" | null;
  member: TeamMember;
  onClose: () => void;
}) {
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <>
      <EditRoleReportingDialog
        member={member}
        onOpenChange={onOpenChange}
        open={dialog === "edit"}
      />
      <TerminateEmployeeDialog
        member={member}
        onOpenChange={onOpenChange}
        open={dialog === "terminate"}
      />
      <ReviewRehireDialog
        member={member}
        onOpenChange={onOpenChange}
        open={dialog === "rehire"}
      />
    </>
  );
}
