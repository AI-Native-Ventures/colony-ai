import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
  useAvailableAcpRuntimes,
} from "@/features/agents/hooks";
import { useAgentDialogDefaults } from "@/features/agents/ui/useAgentDialogDefaults";
import { usePersonaModelDiscovery } from "@/features/agents/ui/usePersonaModelDiscovery";
import { attachManagedAgentToChannel } from "@/features/agents/channelAgents";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useAskHeadQuery } from "@/features/company-asks/hooks";
import type {
  AskHeadRecord,
  HireProposal,
} from "@/features/company-asks/askRecords";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import {
  HireBackButton,
  HireFlash,
  HirePageContent,
  HirePageHeader,
  hirePrimaryButtonClass,
} from "./HirePresentation";
import { HireHandoffScreen } from "./HireHandoffScreen";
import { readHireDraft, removeHireDraft, writeHireDraft } from "../hireDraft";
import {
  useCompanyHireActionMutation,
  useCompanyHireHeadQuery,
} from "../hireRelay";
import {
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "../companyHireModels";
import type { CompanyHireHeadRecord } from "../companyHireModels";

const INTRODUCTION_TEXT = (role: string) =>
  `Hello team. I’ll coordinate ${role} and bring decisions back to the right people.`;

function activeMembers(members: readonly TeamMember[]) {
  return members.filter(
    (member) => (member.position?.head.status ?? "active") === "active",
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function proposalsMatch(first: HireProposal, second: HireProposal) {
  return (
    JSON.stringify(stableValue(first)) === JSON.stringify(stableValue(second))
  );
}

function proposalEqualsRecord(
  record: CompanyHireHeadRecord | null | undefined,
  proposal: HireProposal,
) {
  return (
    record !== null &&
    record !== undefined &&
    proposalsMatch(record.head.proposal, proposal)
  );
}

function responseWasRecorded(record: AskHeadRecord | null | undefined) {
  return (
    record?.head.status === "resolved" &&
    record.head.resolution?.outcome === "approved"
  );
}

function formatAllowance(value: string | undefined) {
  if (!value) return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : value;
}

function ManagerLabel({
  managerPubkey,
  identityPubkey,
  members,
  profiles,
}: {
  managerPubkey?: string;
  identityPubkey?: string;
  members: readonly TeamMember[];
  profiles: UserProfileLookup;
}) {
  const manager = managerPubkey
    ? members.find(
        (member) => member.pubkey.toLowerCase() === managerPubkey.toLowerCase(),
      )
    : members.find((member) => member.role === "owner");
  if (!manager) return <>Company owner</>;
  return (
    <>
      {resolveUserLabel({
        pubkey: manager.pubkey,
        currentPubkey: identityPubkey,
        profiles,
      })}
    </>
  );
}

function useWorkerModelLabel(input: {
  envVars: Record<string, string>;
  providerId: string;
  runtime: AcpRuntimeCatalogEntry | undefined;
  modelId?: string;
}) {
  const { discoveredModelOptions } = usePersonaModelDiscovery({
    envVars: input.envVars,
    isCustomProviderEditing: false,
    modelFieldVisible: true,
    open: input.runtime !== undefined,
    provider: input.providerId,
    selectedRuntime: input.runtime,
  });
  return (
    discoveredModelOptions?.find((option) => option.id === input.modelId)
      ?.label ??
    input.modelId ??
    ""
  );
}

export function HireReviewScreen({
  hireId,
  source,
}: {
  hireId: string;
  source?: { channelId?: string; askId?: string };
}) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const hireQuery = useCompanyHireHeadQuery(hireId);
  const hireAction = useCompanyHireActionMutation();
  const askState = useAskHeadQuery(
    source?.channelId ?? null,
    source?.askId ?? null,
    Boolean(source?.channelId && source?.askId),
  );
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const managedAgentsQuery = useManagedAgentsQuery();
  const createManagedAgent = useCreateManagedAgentMutation();
  const teamQuery = useCompanyTeamQuery();
  const channelsQuery = useChannelsQuery();
  const {
    goAskDetail,
    goChannel,
    goHireConfigure,
    goHireReview,
    goHireSuccess,
    goTeam,
  } = useAppNavigation();
  const [founderConfirmed, setFounderConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState(false);
  const submittingRef = React.useRef(false);

  const draft = readHireDraft(relayUrl, hireId);
  const hasAskSource = Boolean(source?.channelId && source?.askId);
  const proposal = hasAskSource
    ? (hireQuery.data?.head.proposal ?? draft?.proposal ?? null)
    : (draft?.proposal ?? hireQuery.data?.head.proposal ?? null);
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === proposal?.rolePack.personaId,
  );
  const workerRuntime = runtimesQuery.data?.find(
    (candidate) => candidate.id === proposal?.runtimeId,
  );
  const { inheritedEnvVars } = useAgentDialogDefaults({
    inheritedEnvVars: persona?.envVars ?? {},
    open: true,
  });
  const workerModelLabel = useWorkerModelLabel({
    envVars: inheritedEnvVars,
    providerId: proposal?.providerId ?? "",
    runtime: workerRuntime,
    modelId: proposal?.modelId,
  });
  const teamMembers = React.useMemo(
    () => activeMembers(teamQuery.data?.members ?? []),
    [teamQuery.data?.members],
  );
  const memberPubkeys = React.useMemo(
    () =>
      [
        ...teamMembers.map((member) => member.pubkey),
        askState.query.data?.head.askerPubkey,
      ].filter((pubkey): pubkey is string => Boolean(pubkey)),
    [askState.query.data?.head.askerPubkey, teamMembers],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const homeChannel = channelsQuery.data?.find(
    (channel) => channel.id === proposal?.introductionChannelId,
  );
  const identityPubkey = identityQuery.data?.pubkey;
  const currentRole = membershipQuery.data?.role ?? null;

  React.useEffect(() => {
    if (hireQuery.data?.head.status === "hired") {
      void goHireSuccess(hireId, { replace: true });
    }
  }, [goHireSuccess, hireId, hireQuery.data?.head.status]);

  React.useEffect(() => {
    if (hasAskSource) return;
    if (hireQuery.isError) throw hireQuery.error;
    if (askState.query.isError) throw askState.query.error;
    if (personasQuery.isError) throw personasQuery.error;
    if (runtimesQuery.isError) throw runtimesQuery.error;
    if (teamQuery.isError) throw teamQuery.error;
    if (channelsQuery.isError) throw channelsQuery.error;
  }, [
    askState.query.error,
    askState.query.isError,
    channelsQuery.error,
    channelsQuery.isError,
    hireQuery.error,
    hireQuery.isError,
    personasQuery.error,
    personasQuery.isError,
    runtimesQuery.error,
    runtimesQuery.isError,
    teamQuery.error,
    teamQuery.isError,
    hasAskSource,
  ]);

  const publishAction = async (
    input: unknown,
    matches: (record: CompanyHireHeadRecord | null | undefined) => boolean,
  ) => {
    const action = parseCompanyHireAction(input);
    if (!action)
      throw new Error("Hire action did not match its record schema.");
    try {
      await hireAction.mutateAsync(action);
    } catch (cause) {
      const observed = (await hireQuery.refetch()).data;
      if (!matches(observed)) throw cause;
      return observed;
    }
    const observed = (await hireQuery.refetch()).data;
    if (!matches(observed))
      throw new Error("The relay did not confirm the hire change.");
    return observed;
  };

  const resolveHandoff = async (
    outcome: "approved" | "rejected",
    reason: string,
  ) => {
    if (!hasAskSource || !source?.askId || !source.channelId) {
      throw new Error("The hire ask coordinate is missing.");
    }
    if (!identityPubkey || !currentRole) {
      throw new Error("The current member role could not be verified.");
    }

    let askRecord = (await askState.query.refetch()).data;
    let current = (await hireQuery.refetch()).data;
    if (
      !askRecord ||
      !current ||
      current.head.sourceAskId !== source.askId ||
      current.head.sourceAskChannelId !== source.channelId ||
      askRecord.head.askId !== source.askId ||
      askRecord.channelId !== source.channelId ||
      askRecord.head.ask.hireProposal?.hireId !== hireId
    ) {
      throw new Error("The hire proposal and ask no longer match.");
    }

    if (
      current.head.status === "proposed" &&
      askRecord.head.status === "open"
    ) {
      if (currentRole !== "owner" && currentRole !== "admin") {
        throw new Error("Only an owner or admin can resolve a hire ask.");
      }
      const signedResponse = await signRelayEvent({
        kind: KIND_ASK_RESPONSE,
        content: JSON.stringify({
          schemaVersion: 1,
          askId: source.askId,
          expectedHeadEventId: askRecord.event.id,
          outcome,
          reason,
        }),
        tags: [
          ["h", source.channelId],
          ["d", `channel:${source.channelId}:ask:${source.askId}`],
        ],
      });
      let publishError: unknown;
      try {
        await relayClient.publishEvent(
          signedResponse,
          "The ask response timed out before the relay confirmed it.",
          "The ask response timed out before the relay confirmed it.",
        );
      } catch (cause) {
        publishError = cause;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-ask-head", source.channelId, source.askId],
          exact: false,
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-hire-head", relayUrl, hireId.toLowerCase()],
          exact: true,
        }),
      ]);
      askRecord = (await askState.query.refetch()).data;
      current = (await hireQuery.refetch()).data;
      const askConfirmed =
        askRecord?.head.status === "resolved" &&
        askRecord.head.resolution?.outcome === outcome &&
        askRecord.head.resolution.reason === reason;
      const hireConfirmed =
        outcome === "rejected"
          ? current?.head.status === "denied" &&
            current.head.denialReason === reason
          : currentRole === "owner"
            ? current?.head.status === "approved" &&
              current.head.founderPubkey?.toLowerCase() ===
                identityPubkey.toLowerCase() &&
              current.head.founderApprovalReason === reason
            : current?.head.status === "awaiting_founder" &&
              current.head.founderPubkey === undefined;
      if (!askConfirmed || !hireConfirmed) {
        throw (
          publishError ?? new Error("The relay did not confirm the decision.")
        );
      }
      return;
    }

    if (
      current.head.status === "awaiting_founder" &&
      askRecord.head.status === "resolved" &&
      askRecord.head.resolution?.outcome === "approved"
    ) {
      if (currentRole !== "owner") {
        throw new Error("Founder sign-off requires the community owner.");
      }
      await publishAction(
        {
          schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
          hireId,
          action: outcome === "approved" ? "approve" : "deny",
          expectedHeadEventId: current.event.id,
          reason,
        },
        (record) =>
          outcome === "approved"
            ? record?.head.status === "approved" &&
              record.head.founderPubkey?.toLowerCase() ===
                identityPubkey.toLowerCase() &&
              record.head.founderApprovalReason === reason
            : record?.head.status === "denied" &&
              record.head.denialReason === reason,
      );
      const confirmedAsk = (await askState.query.refetch()).data;
      if (
        confirmedAsk?.head.status !== "resolved" ||
        confirmedAsk.head.resolution?.outcome !== "approved"
      ) {
        throw new Error("The hire ask changed during founder sign-off.");
      }
      return;
    }

    throw new Error("The hire stage changed. Refresh the proposal and retry.");
  };

  const runApprovedHire = async (
    initial: CompanyHireHeadRecord,
    selectedProposal: HireProposal,
  ) => {
    if (
      !identityPubkey ||
      initial.head.status !== "approved" ||
      initial.head.founderPubkey?.toLowerCase() !== identityPubkey.toLowerCase()
    ) {
      throw new Error(
        "Hire could not be published. The review is kept. Retry when connected.",
      );
    }

    let employeePubkey = initial.head.employeePubkey ?? draft?.employeePubkey;
    let agent = employeePubkey
      ? managedAgentsQuery.data?.find(
          (candidate) =>
            candidate.pubkey.toLowerCase() === employeePubkey?.toLowerCase(),
        )
      : undefined;

    if (employeePubkey && !agent) {
      const refreshed = await managedAgentsQuery.refetch();
      agent = refreshed.data?.find(
        (candidate) =>
          candidate.pubkey.toLowerCase() === employeePubkey?.toLowerCase(),
      );
    }

    if (!employeePubkey) {
      const runtime = runtimesQuery.data?.find(
        (candidate) => candidate.id === selectedProposal.runtimeId,
      );
      if (
        !persona ||
        !runtime ||
        runtime.availability !== "available" ||
        !runtime.command
      ) {
        throw new Error(
          "Hire could not be published. The review is kept. Retry when connected.",
        );
      }
      const created = await createManagedAgent.mutateAsync({
        name: selectedProposal.displayName,
        personaId: persona.id,
        acpCommand: "buzz-acp",
        agentCommand: runtime.command,
        harnessOverride: !persona.runtime || persona.runtime === runtime.id,
        agentArgs: [],
        mcpCommand: runtime.mcpCommand ?? "",
        model: selectedProposal.modelId,
        provider: selectedProposal.providerId,
        spawnAfterCreate: false,
        startOnAppLaunch: false,
        backend: { type: "local" },
      });
      agent = created.agent;
      employeePubkey = created.agent.pubkey;
      writeHireDraft(relayUrl, {
        proposal: selectedProposal,
        employeePubkey,
        ...(draft?.baseHeadEventId
          ? { baseHeadEventId: draft.baseHeadEventId }
          : {}),
      });
    }

    if (!agent || !employeePubkey) {
      throw new Error(
        "Hire could not be published. The review is kept. Retry when connected.",
      );
    }

    let current = (await hireQuery.refetch()).data;
    if (
      current?.head.status !== "approved" ||
      current.head.founderPubkey?.toLowerCase() !== identityPubkey.toLowerCase()
    ) {
      throw new Error(
        "Hire could not be published. The review is kept. Retry when connected.",
      );
    }
    if (!current.head.employeePubkey) {
      current = await publishAction(
        {
          schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
          hireId,
          action: "attach_employee",
          expectedHeadEventId: current.event.id,
          employeePubkey,
        },
        (record) =>
          record?.head.employeePubkey?.toLowerCase() ===
          employeePubkey?.toLowerCase(),
      );
    } else if (
      current.head.employeePubkey.toLowerCase() !== employeePubkey.toLowerCase()
    ) {
      throw new Error(
        "Hire could not be published. The review is kept. Retry when connected.",
      );
    }

    await attachManagedAgentToChannel(selectedProposal.introductionChannelId, {
      agent,
      role: "bot",
      ensureRunning: false,
    });
    const introduction = await sendManagedAgentChannelMessage({
      agentPubkey: employeePubkey,
      channelId: selectedProposal.introductionChannelId,
      content: INTRODUCTION_TEXT(selectedProposal.title),
      marker: `company-hire:${hireId}:introduction`,
      markerScope: "agent",
    });

    current = (await hireQuery.refetch()).data;
    if (!current)
      throw new Error(
        "Hire could not be published. The review is kept. Retry when connected.",
      );
    if (current.head.status !== "hired") {
      await publishAction(
        {
          schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
          hireId,
          action: "complete",
          expectedHeadEventId: current.event.id,
          employeePubkey,
          introductionEventId: introduction.eventId,
        },
        (record) =>
          record?.head.status === "hired" &&
          record.head.employeePubkey?.toLowerCase() ===
            employeePubkey?.toLowerCase() &&
          record.head.introductionEventId === introduction.eventId,
      );
    }

    removeHireDraft(relayUrl, hireId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["company-team", relayUrl] }),
      queryClient.invalidateQueries({ queryKey: ["channels"] }),
      queryClient.invalidateQueries({ queryKey: ["managed-agents"] }),
      queryClient.invalidateQueries({ queryKey: ["relay-agents"] }),
    ]);
    await goHireSuccess(hireId, { replace: true });
  };

  const approveAndHire = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!founderConfirmed || !proposal || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(false);
    try {
      const identity = identityPubkey;
      if (!identity || currentRole !== "owner") {
        throw new Error("founder sign-off requires the community owner");
      }

      let current = (await hireQuery.refetch()).data;
      if (!current && !source?.askId) {
        try {
          await publishAction(
            {
              schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
              hireId,
              action: "create",
              proposal,
            },
            (record) => proposalEqualsRecord(record, proposal),
          );
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message.toLowerCase() : "";
          if (message.includes("employee display name is already in use")) {
            await goHireConfigure(proposal.rolePack.personaId, hireId, {
              ...source,
              nameTaken: true,
            });
            return;
          }
          throw cause;
        }
        current = (await hireQuery.refetch()).data;
      }

      if (source?.askId && source.channelId) {
        let askRecord = (await askState.query.refetch()).data;
        if (
          !current ||
          current.head.sourceAskId !== source.askId ||
          current.head.sourceAskChannelId !== source.channelId
        ) {
          throw new Error(
            "Hire could not be published. The review is kept. Retry when connected.",
          );
        }
        if (
          current.head.status === "proposed" &&
          !proposalsMatch(current.head.proposal, proposal)
        ) {
          try {
            current = await publishAction(
              {
                schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
                hireId,
                action: "update",
                expectedHeadEventId: current.event.id,
                proposal,
              },
              (record) => proposalEqualsRecord(record, proposal),
            );
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message.toLowerCase() : "";
            if (message.includes("employee display name is already in use")) {
              await goHireConfigure(proposal.rolePack.personaId, hireId, {
                ...source,
                nameTaken: true,
              });
              return;
            }
            throw cause;
          }
        }
        if (!current) {
          throw new Error(
            "Hire could not be published. The review is kept. Retry when connected.",
          );
        }
        if (
          current.head.status === "proposed" &&
          askRecord?.head.status === "open"
        ) {
          const response = await signRelayEvent({
            kind: KIND_ASK_RESPONSE,
            content: JSON.stringify({
              schemaVersion: 1,
              askId: source.askId,
              expectedHeadEventId: askRecord.event.id,
              outcome: "approved",
            }),
            tags: [
              ["h", source.channelId],
              ["d", `channel:${source.channelId}:ask:${source.askId}`],
            ],
          });
          try {
            await relayClient.publishEvent(
              response,
              "The ask response timed out before the relay confirmed it.",
              "The ask response could not be sent.",
            );
          } catch (cause) {
            askRecord = (await askState.query.refetch()).data;
            current = (await hireQuery.refetch()).data;
            if (
              !(
                responseWasRecorded(askRecord) &&
                current?.head.status === "approved" &&
                current.head.founderPubkey?.toLowerCase() ===
                  identity.toLowerCase()
              )
            ) {
              throw cause;
            }
          }
          await queryClient.invalidateQueries({
            queryKey: ["company-ask-head", source.channelId, source.askId],
            exact: false,
          });
        } else if (!responseWasRecorded(askRecord)) {
          throw new Error(
            "Hire could not be published. The review is kept. Retry when connected.",
          );
        }
        current = (await hireQuery.refetch()).data;
      } else if (current?.head.status === "proposed") {
        if (!proposalsMatch(current.head.proposal, proposal)) {
          try {
            current = await publishAction(
              {
                schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
                hireId,
                action: "update",
                expectedHeadEventId: current.event.id,
                proposal,
              },
              (record) => proposalEqualsRecord(record, proposal),
            );
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message.toLowerCase() : "";
            if (message.includes("employee display name is already in use")) {
              await goHireConfigure(proposal.rolePack.personaId, hireId, {
                ...source,
                nameTaken: true,
              });
              return;
            }
            throw cause;
          }
        }
        if (!current) {
          throw new Error(
            "Hire could not be published. The review is kept. Retry when connected.",
          );
        }
        current = await publishAction(
          {
            schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
            hireId,
            action: "approve",
            expectedHeadEventId: current.event.id,
          },
          (record) =>
            record?.head.status === "approved" &&
            record.head.founderPubkey?.toLowerCase() === identity.toLowerCase(),
        );
      }

      current = (await hireQuery.refetch()).data;
      if (current?.head.status !== "approved") {
        throw new Error("founder sign-off requires the community owner");
      }
      await runApprovedHire(current, proposal);
    } catch {
      setFailure(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (hasAskSource && source?.askId && source.channelId) {
    const handoffRecord = hireQuery.data ?? null;
    const handoffAsk = askState.query.data ?? null;
    const handoffLoading =
      hireQuery.isPending ||
      askState.query.isPending ||
      identityQuery.isPending ||
      membershipQuery.isPending;
    const coordinatesMatch = Boolean(
      handoffRecord &&
        handoffAsk &&
        handoffRecord.head.sourceAskId === source.askId &&
        handoffRecord.head.sourceAskChannelId === source.channelId &&
        handoffAsk.head.askId === source.askId &&
        handoffAsk.channelId === source.channelId &&
        handoffAsk.head.ask.hireProposal?.hireId === hireId,
    );
    const unavailable =
      hireQuery.isError ||
      askState.query.isError ||
      (!handoffLoading && !coordinatesMatch);
    const requesterPubkey = handoffAsk?.head.askerPubkey;
    const askerLabel = requesterPubkey
      ? resolveUserLabel({
          pubkey: requesterPubkey,
          currentPubkey: identityPubkey,
          profiles,
        })
      : "Requester";

    return (
      <HireHandoffScreen
        askerLabel={askerLabel}
        askRecord={handoffAsk}
        currentRole={currentRole}
        loading={handoffLoading}
        onBack={() => {
          const threadRootId = handoffAsk?.head.ask.threadRootEventId;
          if (threadRootId && source.channelId) {
            void goChannel(source.channelId, {
              messageId: threadRootId,
              threadRootId,
            });
          } else {
            void goTeam();
          }
        }}
        onOpenPosition={() => void goHireReview(hireId)}
        onReadProposal={() => {
          if (source.channelId && source.askId) {
            void goAskDetail(source.channelId, source.askId);
          }
        }}
        onResolve={resolveHandoff}
        onRetry={() => {
          void Promise.all([hireQuery.refetch(), askState.query.refetch()]);
        }}
        record={handoffRecord}
        unavailable={unavailable}
      />
    );
  }

  if (
    !proposal ||
    hireQuery.isPending ||
    personasQuery.isPending ||
    runtimesQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending ||
    teamQuery.isPending ||
    channelsQuery.isPending
  )
    return null;

  const reportingMembers = activeMembers(teamQuery.data?.members ?? []);

  return (
    <>
      <HirePageHeader title="Review hire" />
      <HirePageContent>
        <HireBackButton
          onClick={() =>
            void goHireConfigure(proposal.rolePack.personaId, hireId, source)
          }
        />
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Review hire
        </h1>
        <HireFlash>Review the exact scope before hiring.</HireFlash>
        <form
          className="grid max-w-[40.625rem] gap-5 rounded-[10px] border border-border bg-card p-[25px]"
          data-testid="hire-review-form"
          onSubmit={(event) => void approveAndHire(event)}
        >
          <h2 className="text-base font-semibold text-foreground">
            {proposal.displayName} · {proposal.title}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-[5.75rem_minmax(0,1fr)]">
            <dt className="font-medium text-foreground">Reports to</dt>
            <dd className="text-muted-foreground">
              <ManagerLabel
                managerPubkey={proposal.managerPubkey}
                identityPubkey={identityPubkey}
                members={reportingMembers}
                profiles={profiles}
              />
            </dd>
            <dt className="font-medium text-foreground">Channel</dt>
            <dd className="text-muted-foreground">
              #{homeChannel?.name ?? ""}
            </dd>
            <dt className="font-medium text-foreground">Allowance</dt>
            <dd className="text-muted-foreground">
              USD {formatAllowance(proposal.weeklyAllowance)} / week
            </dd>
            <dt className="font-medium text-foreground">Workers</dt>
            <dd className="text-muted-foreground">{workerModelLabel}</dd>
            <dt className="font-medium text-foreground">Lead tools</dt>
            <dd className="text-muted-foreground">
              {proposal.rolePack.tools.map((tool) => tool.name).join(", ")}
            </dd>
          </dl>
          <label
            className="flex items-start gap-3 border-b border-border px-1 py-4 text-sm text-foreground"
            htmlFor="hire-founder-confirm"
          >
            <input
              checked={founderConfirmed}
              data-testid="hire-founder-confirm"
              id="hire-founder-confirm"
              onChange={(event) => setFounderConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I am the founder and approve this employee, scope and allowance.
            </span>
          </label>
          {failure ? (
            <p
              className="text-sm text-destructive"
              data-testid="hire-review-error"
              role="alert"
            >
              Hire could not be published. The review is kept. Retry when
              connected.
            </p>
          ) : null}
          <div className="mt-1 flex gap-3 border-t border-border pt-5">
            <Button
              className={hirePrimaryButtonClass}
              data-testid="hire-approve"
              disabled={
                !founderConfirmed || currentRole !== "owner" || submitting
              }
              type="submit"
            >
              Approve and hire
            </Button>
            <Button
              data-testid="hire-edit-details"
              onClick={() =>
                void goHireConfigure(
                  proposal.rolePack.personaId,
                  hireId,
                  source,
                )
              }
              type="button"
              variant="outline"
            >
              Edit details
            </Button>
          </div>
        </form>
      </HirePageContent>
    </>
  );
}
