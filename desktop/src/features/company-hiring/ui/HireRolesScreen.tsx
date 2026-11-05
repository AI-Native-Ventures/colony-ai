import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAppShell } from "@/app/AppShellContext";
import {
  personasQueryKey,
  useAcpRuntimesQuery,
  useCreatePersonaMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listPersonas } from "@/shared/api/tauriPersonas";
import type { Channel } from "@/shared/api/types";
import {
  buildRoleCatalog,
  materializeBuiltInRole,
  type RoleCatalogEntry,
} from "../builtInRoles";
import { PlusGlyph, RoleIcon, ToolChip, toolPlainText } from "./hireTools";
import {
  HireButton,
  HirePage,
  HireRecovery,
  HireSteps,
  HireTitle,
} from "./HirePresentation";

function scoutChannel(channels: readonly Channel[], scoutPubkey: string) {
  const key = scoutPubkey.toLowerCase();
  return channels
    .filter(
      (channel) =>
        channel.isMember &&
        channel.channelType === "stream" &&
        channel.memberPubkeys.some((pubkey) => pubkey.toLowerCase() === key),
    )
    .sort((left, right) => {
      const leftScore = left.name.trim().toLowerCase() === "general" ? 0 : 1;
      const rightScore = right.name.trim().toLowerCase() === "general" ? 0 : 1;
      return leftScore - rightScore || left.name.localeCompare(right.name);
    })[0];
}

function scoutDraftPrompt(description: string) {
  return [
    "Please help me create a new teammate for this job:",
    description.trim(),
    "",
    "Draft a clear HireRolePack with a title, job, skills, tools and risk levels, worker menu, and a sensible weekly allowance or null. Create or reuse the matching role persona, then use the existing `buzz asks propose-hire` flow to post a HireProposal approval ask in this thread. Do not hire or configure the agent. I will review and approve the hire ask first.",
  ].join("\n");
}

function CustomRoleComposer({
  channel,
  disabled,
  error,
  onSubmit,
  onOpenThread,
  sending,
  sent,
  value,
  onChange,
}: {
  channel: Channel | undefined;
  disabled: boolean;
  error: string | null;
  onSubmit: () => void;
  onOpenThread: () => void;
  sending: boolean;
  sent: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section
      aria-label="Ask Scout to draft"
      className="grid gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
      data-testid="hire-custom-role"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Ask Scout to draft
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Prefer a guided draft? Describe the work and Scout will prepare a hire
          ask for you to review.
        </p>
      </div>
      {sent ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground" role="status">
            Your request is in Scout’s thread. Review the hire ask when Scout
            posts it.
          </p>
          <HireButton onClick={onOpenThread} size="sm" variant="outline">
            Open Scout’s thread
          </HireButton>
        </div>
      ) : (
        <>
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor="hire-custom-role-description"
          >
            What should this teammate do?
            <textarea
              className="min-h-28 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="hire-custom-role-description"
              disabled={disabled || sending}
              id="hire-custom-role-description"
              maxLength={2000}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Describe the work, the outcome you need, and any important boundaries."
              value={value}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {channel
                ? `Scout will draft in #${channel.name}. You approve the ask before anyone is hired.`
                : "Add Scout to a shared conversation before asking for a custom role."}
            </p>
            <HireButton
              disabled={
                disabled || sending || value.trim().length === 0 || !channel
              }
              onClick={onSubmit}
              size="md"
              testId="hire-custom-role-submit"
            >
              {sending ? "Asking Scout…" : "Ask Scout to draft"}
            </HireButton>
          </div>
        </>
      )}
      {error ? (
        <p
          className="text-sm text-destructive"
          data-testid="hire-custom-role-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function allowance(entry: RoleCatalogEntry) {
  return entry.rolePack.defaultAllowance
    ? `USD ${entry.rolePack.defaultAllowance} / week`
    : "No default amount";
}

function RoleCard({
  entry,
  onConfigure,
  onEdit,
  onOpen,
  selected,
  working,
}: {
  entry: RoleCatalogEntry;
  onConfigure: (entry: RoleCatalogEntry) => void;
  onEdit: (entry: RoleCatalogEntry) => void;
  onOpen: (entry: RoleCatalogEntry) => void;
  selected: boolean;
  working: boolean;
}) {
  const { persona, rolePack } = entry;
  return (
    <article
      className="colony-hire-role"
      data-selected={selected}
      data-testid={`hire-role-${persona.id}`}
    >
      <div className="colony-hire-role-head">
        <span className="colony-hire-icon-tile" data-active={selected}>
          <RoleIcon job={rolePack.job} title={rolePack.title} />
        </span>
        <div className="colony-hire-role-copy">
          <button
            aria-pressed={selected}
            className="colony-hire-role-title"
            onClick={() => onOpen(entry)}
            type="button"
          >
            <h2>{rolePack.title}</h2>
            <span>
              {rolePack.job} · {rolePack.skills.join(", ")}
            </span>
          </button>
        </div>
      </div>
      <dl className="colony-hire-facts">
        <dt>Tools</dt>
        <dd
          className="colony-hire-tools"
          data-stacked={rolePack.tools.length > 1 || undefined}
        >
          {rolePack.tools.length > 0 ? (
            rolePack.tools.map((tool) => (
              <span
                className="colony-hire-tool"
                key={`${tool.name}:${tool.risk}`}
              >
                {tool.name}{" "}
                <ToolChip detailed={rolePack.tools.length === 1} tool={tool} />
              </span>
            ))
          ) : (
            <span data-muted="true">No tools included</span>
          )}
        </dd>
        <dt>Worker</dt>
        <dd>{rolePack.workerMenu.join(", ")}</dd>
        <dt>Allowance</dt>
        <dd data-muted={!rolePack.defaultAllowance || undefined}>
          {allowance(entry)}
        </dd>
      </dl>
      <div className="colony-hire-role-actions">
        <HireButton
          disabled={working}
          onClick={() => onConfigure(entry)}
          size="sm"
          testId={`hire-configure-${persona.id}`}
        >
          Configure this role
        </HireButton>
        <HireButton
          disabled={working}
          onClick={() => onOpen(entry)}
          size="sm"
          variant="outline"
        >
          Open role pack
        </HireButton>
        <button
          className="colony-hire-link"
          disabled={working}
          onClick={() => onEdit(entry)}
          type="button"
        >
          Edit pack
        </button>
      </div>
    </article>
  );
}

export function HireRolesScreen() {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const agentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const { goHireConfigure, goHireRolePack, goTeam, goChannel } =
    useAppNavigation();
  const appShell = useAppShell();
  const queryClient = useQueryClient();
  const createPersona = useCreatePersonaMutation();
  const { activeCommunity } = useCommunities();
  const sendMessage = useSendMessageMutation(null, identityQuery.data);
  const [adding, setAdding] = React.useState(false);
  const [addFailed, setAddFailed] = React.useState(false);
  const [selectedRoleId, setSelectedRoleId] = React.useState<string | null>(
    null,
  );
  const [customDescription, setCustomDescription] = React.useState("");
  const [customError, setCustomError] = React.useState<string | null>(null);
  const [customThread, setCustomThread] = React.useState<{
    channelId: string;
    messageId: string;
  } | null>(null);
  const addingRef = React.useRef(false);
  const customSendingRef = React.useRef(false);

  const authorized =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const failed =
    personasQuery.isError || runtimesQuery.isError || membershipQuery.isError;
  const loading =
    personasQuery.isPending ||
    runtimesQuery.isPending ||
    membershipQuery.isPending;
  const scout = (agentsQuery.data ?? []).find(
    (agent) =>
      agent.personaId === "builtin:fizz" ||
      agent.name.trim().toLocaleLowerCase() === "scout",
  );
  const channel = scout
    ? scoutChannel(channelsQuery.data ?? [], scout.pubkey)
    : undefined;
  const sendDisabled =
    agentsQuery.isPending ||
    agentsQuery.isError ||
    channelsQuery.isPending ||
    channelsQuery.isError ||
    identityQuery.data == null ||
    scout == null;

  if (loading || failed || !authorized) {
    const retry = () => {
      void Promise.all([
        personasQuery.refetch(),
        runtimesQuery.refetch(),
        membershipQuery.refetch(),
      ]);
    };
    return (
      <HirePage testId="hire-roles">
        <HireTitle
          subtitle="Choose the role a new AI employee will fill."
          title="Role catalog"
        />
        {loading ? (
          <section
            aria-label="Loading role catalog"
            className="colony-hire-loading"
          >
            <div className="colony-hire-banner" role="status">
              Loading the latest record. Actions become available after the
              shared source responds.
            </div>
            <div aria-hidden="true" className="colony-hire-skeleton" />
          </section>
        ) : failed ? (
          <HireRecovery
            action={
              <HireButton onClick={retry} size="md">
                Try again
              </HireButton>
            }
            title="This information could not load"
          >
            A connection failure is not an empty record. Your draft is kept.
          </HireRecovery>
        ) : (
          <HireRecovery
            action={
              <HireButton
                onClick={() => void goTeam()}
                size="md"
                variant="outline"
              >
                Back to the record
              </HireButton>
            }
            title="You do not have permission for this action"
          >
            Your view access is unchanged. An authorized person can review the
            proposal.
          </HireRecovery>
        )}
      </HirePage>
    );
  }

  const options = buildRoleCatalog(personasQuery.data ?? []);
  const catalogLead = options.slice(0, 3);
  const catalogRemainder = options.slice(3);
  const selected =
    options.find((entry) => entry.persona.id === selectedRoleId) ??
    options[0] ??
    null;
  const availableRuntimes = new Set(
    (runtimesQuery.data ?? [])
      .filter((runtime) => runtime.availability === "available")
      .map((runtime) => runtime.id),
  );
  const personaIdFor = (entry: RoleCatalogEntry) =>
    entry.builtIn
      ? materializeBuiltInRole(entry.builtIn, {
          createPersona: createPersona.mutateAsync,
          listPersonas: () =>
            queryClient.fetchQuery({
              queryFn: listPersonas,
              queryKey: personasQueryKey,
              staleTime: 0,
            }),
          scope: activeCommunity?.relayUrl,
        })
      : Promise.resolve(entry.persona.id);
  const runRoleAction = async (
    entry: RoleCatalogEntry,
    action: (personaId: string) => Promise<unknown>,
  ) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddFailed(false);
    try {
      await action(await personaIdFor(entry));
    } catch {
      setAddFailed(true);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  const configure = (entry: RoleCatalogEntry) =>
    runRoleAction(entry, (personaId) =>
      goHireConfigure(personaId, crypto.randomUUID()),
    );
  const edit = (entry: RoleCatalogEntry) =>
    runRoleAction(entry, (personaId) => goHireRolePack(personaId));
  const openCustomThread = () => {
    if (!customThread) return;
    void goChannel(customThread.channelId, { thread: customThread.messageId });
  };
  const askScout = async () => {
    if (
      customSendingRef.current ||
      !channel ||
      !scout ||
      !customDescription.trim()
    )
      return;
    customSendingRef.current = true;
    setCustomError(null);
    try {
      const message = await sendMessage.mutateAsync({
        channelId: channel.id,
        targetChannel: channel,
        content: `@Scout ${scoutDraftPrompt(customDescription)}`,
        mentionPubkeys: [scout.pubkey],
      });
      const thread = { channelId: channel.id, messageId: message.id };
      setCustomThread(thread);
      await goChannel(thread.channelId, { thread: thread.messageId });
    } catch (cause) {
      setCustomError(
        cause instanceof Error
          ? cause.message
          : "Scout could not be reached. Your description is still here; try again.",
      );
    } finally {
      customSendingRef.current = false;
    }
  };

  return (
    <HirePage testId="hire-roles">
      <HireTitle
        action={
          <HireButton
            onClick={() => void goHireRolePack()}
            size="xl"
            testId="hire-create-role"
          >
            <PlusGlyph size={17} /> Create role pack
          </HireButton>
        }
        subtitle="Choose the role a new AI employee will fill."
        title="Role catalog"
      />
      <HireSteps current={1} />
      <section aria-label="Role catalog" className="colony-hire-columns">
        <section aria-label="Role packs" className="colony-hire-roles">
          {catalogLead.map((entry) => (
            <RoleCard
              entry={entry}
              key={entry.persona.id}
              onConfigure={(role) => void configure(role)}
              onEdit={(role) => void edit(role)}
              onOpen={(role) => setSelectedRoleId(role.persona.id)}
              selected={selected?.persona.id === entry.persona.id}
              working={adding}
            />
          ))}
          <article
            className="colony-hire-role-empty"
            data-testid="hire-create-role-entry"
          >
            <span className="colony-hire-icon-tile">
              <PlusGlyph />
            </span>
            <h2>Create a role</h2>
            <p>
              Write the job, its skills and the tools it may use. You can
              configure and hire this role directly.
            </p>
            <HireButton
              onClick={() => void goHireRolePack()}
              size="sm"
              variant="outline"
            >
              Create role pack
            </HireButton>
          </article>
          {catalogRemainder.map((entry) => (
            <RoleCard
              entry={entry}
              key={entry.persona.id}
              onConfigure={(role) => void configure(role)}
              onEdit={(role) => void edit(role)}
              onOpen={(role) => setSelectedRoleId(role.persona.id)}
              selected={selected?.persona.id === entry.persona.id}
              working={adding}
            />
          ))}
        </section>
        <aside aria-label="Role pack preview" className="colony-hire-aside">
          {selected ? (
            <section className="colony-hire-card colony-hire-panel">
              <p className="colony-hire-eyebrow">Role pack preview</p>
              <h2 className="colony-hire-panel-title">
                {selected.rolePack.title}
              </h2>
              <dl className="colony-hire-detail">
                <div>
                  <dt>Job</dt>
                  <dd>{selected.rolePack.job}</dd>
                </div>
                <div data-chips="true">
                  <dt>Skills</dt>
                  <dd data-chips="true">
                    {selected.rolePack.skills.map((skill) => (
                      <span className="colony-hire-skill" key={skill}>
                        {skill}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>
                    {selected.rolePack.tools.map(toolPlainText).join(", ") ||
                      "No tools included"}
                  </dd>
                </div>
                <div>
                  <dt>Worker menu</dt>
                  <dd>{selected.rolePack.workerMenu.join(", ")}</dd>
                </div>
                <div>
                  <dt>Allowance</dt>
                  <dd>{allowance(selected)}</dd>
                </div>
              </dl>
              <div className="colony-hire-panel-actions">
                <HireButton
                  disabled={adding}
                  onClick={() => void configure(selected)}
                  size="lg"
                >
                  Configure this role
                </HireButton>
                <div className="flex gap-2">
                  <HireButton
                    disabled={adding}
                    onClick={() => void configure(selected)}
                    size="md"
                    variant="outline"
                  >
                    Propose a hire
                  </HireButton>
                  <HireButton
                    disabled={adding}
                    onClick={() => void edit(selected)}
                    size="md"
                    variant="outline"
                  >
                    Edit role pack
                  </HireButton>
                </div>
              </div>
            </section>
          ) : null}
          {availableRuntimes.size === 0 ? (
            <section
              aria-label="No runtime is available"
              className="colony-hire-notice"
              role="note"
            >
              <strong>No runtime is available</strong>
              <p>
                A new employee needs a harness to run in. Add one, then come
                back to finish the hire.
              </p>
              <HireButton
                onClick={() => appShell.onOpenSettings?.("agents")}
                size="sm"
                variant="outline"
              >
                Open harness settings
              </HireButton>
            </section>
          ) : null}
        </aside>
      </section>
      {addFailed ? (
        <p
          className="colony-hire-error"
          data-testid="hire-role-add-error"
          role="alert"
        >
          The role could not be opened. Try again.
        </p>
      ) : null}
      <CustomRoleComposer
        channel={channel}
        disabled={sendDisabled}
        error={customError}
        onChange={setCustomDescription}
        onOpenThread={openCustomThread}
        onSubmit={() => void askScout()}
        sending={sendMessage.isPending}
        sent={customThread != null}
        value={customDescription}
      />
      {agentsQuery.isError || channelsQuery.isError ? (
        <p className="text-xs text-muted-foreground" role="status">
          Scout’s shared conversation could not be checked. Retry after the
          connection returns.
        </p>
      ) : null}
      {agentsQuery.isPending || channelsQuery.isPending ? (
        <p className="text-xs text-muted-foreground" role="status">
          Checking for Scout’s shared conversation…
        </p>
      ) : null}
    </HirePage>
  );
}
