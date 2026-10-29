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
import {
  agentAntAvatarDataUrl,
  agentFunctionFromRole,
} from "@/features/agents/ui/agentAntAvatar";
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
import {
  HireButton,
  HirePage,
  HireRecovery,
  HireTitle,
} from "./HirePresentation";

const FUNCTION_GROUPS = [
  "Sales",
  "Operations",
  "Customer Success",
  "Finance",
  "Brand",
  "Other",
] as const;

function roleFunction(entry: RoleCatalogEntry) {
  return agentFunctionFromRole(
    `${entry.rolePack.job} ${entry.rolePack.title} ${entry.persona.displayName}`,
  );
}

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
      aria-label="Create your own role"
      className="grid gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
      data-testid="hire-custom-role"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Create your own role
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the work. Scout will draft a hire ask for you to review.
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

export function HireRolesScreen() {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const agentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const { goHireConfigure, goTeam, goChannel } = useAppNavigation();
  const appShell = useAppShell();
  const queryClient = useQueryClient();
  const createPersona = useCreatePersonaMutation();
  const { activeCommunity } = useCommunities();
  const sendMessage = useSendMessageMutation(null, identityQuery.data);
  const [adding, setAdding] = React.useState(false);
  const [addFailed, setAddFailed] = React.useState(false);
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
          subtitle="Choose the work you need help with."
          title="Hire an agent"
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
  const availableRuntimes = new Set(
    (runtimesQuery.data ?? [])
      .filter((runtime) => runtime.availability === "available")
      .map((runtime) => runtime.id),
  );
  const groupedOptions = FUNCTION_GROUPS.map((name) => ({
    name,
    entries: options.filter((entry) => roleFunction(entry) === name),
  })).filter((group) => group.entries.length > 0);

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
  const configure = async (entry: RoleCatalogEntry) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddFailed(false);
    try {
      await goHireConfigure(await personaIdFor(entry), crypto.randomUUID());
    } catch {
      setAddFailed(true);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
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
        subtitle="Choose the work you need help with."
        title="Hire an agent"
      />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-8">
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
        <section aria-label="Role catalog" className="space-y-7">
          {groupedOptions.map((group) => (
            <section
              aria-label={group.name}
              className="space-y-2"
              key={group.name}
            >
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.name}
              </h2>
              <div className="space-y-2">
                {group.entries.map((entry) => (
                  <article
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4"
                    data-testid={`hire-role-${entry.persona.id}`}
                    key={entry.persona.id}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                      <img
                        alt={`${entry.persona.displayName} ant`}
                        className="h-full w-full object-contain"
                        src={agentAntAvatarDataUrl(group.name)}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {entry.persona.displayName}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {entry.persona.description || entry.rolePack.job}
                      </p>
                    </div>
                    <HireButton
                      disabled={adding}
                      onClick={() => void configure(entry)}
                      size="sm"
                      testId={`hire-configure-${entry.persona.id}`}
                    >
                      Configure
                    </HireButton>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>
        {addFailed ? (
          <p
            className="text-sm text-destructive"
            data-testid="hire-role-add-error"
            role="alert"
          >
            The role could not be opened. Try again.
          </p>
        ) : null}
        {availableRuntimes.size === 0 ? (
          <section
            aria-label="No harness is available"
            className="rounded-xl border border-border p-4"
            role="note"
          >
            <h2 className="text-sm font-semibold text-foreground">
              No harness is available
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a harness in settings before you configure a role.
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
      </div>
    </HirePage>
  );
}
