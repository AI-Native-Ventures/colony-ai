import * as React from "react";
import { Link } from "@tanstack/react-router";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useRelayAgentsQuery } from "@/features/agents/hooks";
import {
  findUniqueWorkItem,
  useAllWorkItemHeadsQuery,
} from "@/features/clients/useBusinessRecords";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { Button } from "@/shared/ui/button";
import { useAskHeadQuery } from "../hooks";
import type { AskHeadQueryState } from "../hooks";
import { mapSpecializedAskCard } from "../askCardMapping";
import { AskDecisionDetail } from "./AskDecisionDetail";
import type { DecisionDetailModel } from "./AskDecisionDetail";
import { WORK_STATUS_LABELS } from "./AskDecisionParts";
import type { LinkedWorkView } from "./AskDecisionParts";
import { AskThreadOutcomeCard } from "./AskOutcomeCard";
import type { OutcomeActorView } from "./AskOutcomeCard";
import { AskResponseForm } from "./AskResponseForm";
import { DutyAskCard } from "./DutyAskCard";
import { HireAskCard } from "./HireAskCard";
import {
  formatAskDate,
  formatClockTime,
  formatDeadline,
  formatTileDate,
} from "./askCardFormatting";
import { describeOutcome, outcomeLabel, typeLabel } from "./askOutcomeModel";
import type { OutcomeChip } from "./askOutcomeModel";
import { formatUsdCents } from "@/features/power/spendModels";
import type { AskHead } from "../askRecords";

function accessReason(input: {
  head: AskHead;
  channelMember: boolean;
  isAgent: boolean;
  pubkey: string;
  communityRole: string | null;
}) {
  const { head, channelMember, isAgent, pubkey, communityRole } = input;
  if (head.ask.category !== "general") {
    if (isAgent)
      return "Agents cannot decide spending, hires, tools, secrets or duties";
    if (communityRole !== "owner" && communityRole !== "admin") {
      return "Only company owners and admins can decide this";
    }
    return null;
  }
  if (!channelMember) return "Only members of this conversation can answer";
  const addressee = head.ask.addresseePubkey;
  if (addressee) {
    if (normalizePubkey(addressee) !== normalizePubkey(pubkey)) {
      return "This ask is addressed to someone else";
    }
    if (
      isAgent &&
      head.ask.type !== "question" &&
      head.ask.type !== "verdict"
    ) {
      return "Agents can only answer questions and verdicts";
    }
    return null;
  }
  if (isAgent)
    return "Only people can answer an ask that is not addressed to anyone";
  return null;
}

/**
 * Finds the work item an ask is about, wherever it lives: the decision page
 * links to it even when the ask was raised in a different channel (a funding
 * ask raised in Operations about work for a client). Only mounted for asks
 * that carry a work item subject, so ordinary cards load no business records.
 */
function WithLinkedWork({
  askChannelId,
  workItemId,
  children,
}: {
  askChannelId: string;
  workItemId: string;
  children: (
    linkedWork: LinkedWorkView | null,
    profiles: UserProfileLookup,
  ) => React.ReactNode;
}) {
  const workItemsQuery = useAllWorkItemHeadsQuery(true);
  const channelsQuery = useChannelsQuery();
  const record = React.useMemo(() => {
    try {
      return findUniqueWorkItem(workItemsQuery.data ?? [], workItemId, null);
    } catch {
      return null;
    }
  }, [workItemId, workItemsQuery.data]);
  const assignees = record?.value.assignedPubkeys ?? [];
  const profilesQuery = useUsersBatchQuery(assignees, {
    enabled: assignees.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  let linkedWork: LinkedWorkView | null = null;
  if (record) {
    const clientName =
      record.value.clientId.toLowerCase() === askChannelId.toLowerCase()
        ? null
        : (channelsQuery.data?.find(
            (channel) =>
              channel.id.toLowerCase() === record.value.clientId.toLowerCase(),
          )?.name ?? null);
    const assigneeNames = assignees.map((pubkey) =>
      resolveUserLabel({ pubkey, profiles }),
    );
    linkedWork = {
      workItemId: record.value.workItemId,
      clientId: record.value.clientId,
      title: record.value.title,
      status: record.value.status,
      statusLabel:
        WORK_STATUS_LABELS[record.value.status] ?? record.value.status,
      meta: [clientName, assigneeNames.join(", ")]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
    };
  }
  return <>{children(linkedWork, profiles)}</>;
}

function LoadingCard({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Ask"
      className="colony-outcome-card"
      data-testid={testId}
    >
      {children}
    </section>
  );
}

export function AskCard({
  askId,
  channelId,
  currentPubkey,
  profiles,
  queryState,
  showDetailLink = true,
  lazyQueryEnabled = true,
  leading,
  showDiscussionLink = true,
}: {
  askId: string;
  channelId: string | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  queryState?: AskHeadQueryState;
  showDetailLink?: boolean;
  lazyQueryEnabled?: boolean;
  /** The decision page shows the anchoring message above the card. */
  leading?: React.ReactNode;
  /** Whether the viewer can open the discussion the ask belongs to. */
  showDiscussionLink?: boolean;
}) {
  const localQueryState = useAskHeadQuery(
    channelId,
    askId,
    queryState === undefined && lazyQueryEnabled,
  );
  const { query, relaySelfQuery, liveState } = queryState ?? localQueryState;
  const channelsQuery = useChannelsQuery();
  const membersQuery = useChannelMembersQuery(channelId, Boolean(channelId));
  const membershipQuery = useMyRelayMembershipQuery();
  const agentsQuery = useRelayAgentsQuery({ enabled: Boolean(channelId) });
  const identityQuery = useIdentityQuery();
  const resolverPubkey = identityQuery.data?.pubkey ?? currentPubkey;
  const headRecord = query.data;
  const head = headRecord?.head;

  if (!channelId) {
    return (
      <LoadingCard testId="ask-card-unavailable">
        <p role="status">Open this discussion to view the ask.</p>
      </LoadingCard>
    );
  }
  if (
    relaySelfQuery.isError ||
    (relaySelfQuery.isSuccess && !relaySelfQuery.data)
  ) {
    return (
      <LoadingCard testId="ask-card-unavailable">
        <p role="alert">
          The relay identity is unavailable, so this ask cannot be verified.
        </p>
        <Button
          onClick={() => void relaySelfQuery.refetch()}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </LoadingCard>
    );
  }
  if (relaySelfQuery.isPending) {
    return (
      <LoadingCard testId="ask-card-loading">
        <p role="status">Checking the relay-signed ask…</p>
      </LoadingCard>
    );
  }
  if (query.isPending) {
    return (
      <LoadingCard testId="ask-card-loading">
        <p role="status">Loading the latest ask…</p>
      </LoadingCard>
    );
  }
  if (query.isError) {
    return (
      <LoadingCard testId="ask-card-error">
        <p role="alert">
          {query.error instanceof Error
            ? query.error.message
            : "The ask could not be loaded."}
        </p>
        <Button
          onClick={() => void query.refetch()}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </LoadingCard>
    );
  }
  if (!head || !headRecord) {
    return (
      <LoadingCard testId="ask-card-missing">
        <p role="status">This ask is no longer available.</p>
      </LoadingCard>
    );
  }

  const channelMember =
    resolverPubkey !== undefined &&
    membersQuery.data?.some(
      (member) =>
        normalizePubkey(member.pubkey) === normalizePubkey(resolverPubkey),
    ) === true;
  const currentIsAgent =
    resolverPubkey !== undefined &&
    agentsQuery.data?.some(
      (agent) =>
        normalizePubkey(agent.pubkey) === normalizePubkey(resolverPubkey),
    ) === true;
  const checksReady =
    Boolean(resolverPubkey) &&
    identityQuery.isSuccess &&
    (head.ask.category !== "general" || membersQuery.isSuccess) &&
    membershipQuery.isSuccess &&
    agentsQuery.isSuccess &&
    relaySelfQuery.isSuccess &&
    relaySelfQuery.data !== null;
  const deniedReason =
    checksReady && resolverPubkey
      ? accessReason({
          head,
          channelMember,
          isAgent: currentIsAgent,
          pubkey: resolverPubkey,
          communityRole: membershipQuery.data?.role ?? null,
        })
      : null;
  const accessFailure =
    identityQuery.isError ||
    (head.ask.category === "general" && membersQuery.isError) ||
    membershipQuery.isError ||
    agentsQuery.isError ||
    relaySelfQuery.isError ||
    relaySelfQuery.data === null;
  const isOverdue =
    head.status === "open" &&
    Boolean(head.ask.decideBy) &&
    Date.parse(head.ask.decideBy ?? "") < Date.now();
  const statusText = isOverdue
    ? "Overdue · still open"
    : head.status === "resolved" && head.resolution
      ? outcomeLabel(head.resolution.outcome)
      : head.status;
  const specializedVariant = mapSpecializedAskCard(head.ask);
  const kind = specializedVariant?.kind;
  const specializedDetail = Boolean(
    specializedVariant &&
      (!showDetailLink || kind === "hire" || kind === "duty"),
  );
  const asker = resolveUserLabel({
    pubkey: head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const askerProfile = profiles?.[normalizePubkey(head.askerPubkey)];
  const askerIsAgent =
    askerProfile?.isAgent === true ||
    agentsQuery.data?.some(
      (agent) =>
        normalizePubkey(agent.pubkey) === normalizePubkey(head.askerPubkey),
    ) === true;
  const channelName =
    channelsQuery.data?.find((channel) => channel.id === channelId)?.name ??
    "conversation";
  const needsYou = head.status === "open" && checksReady && !deniedReason;
  const decisionHeading =
    head.status === "open"
      ? "Decision requested"
      : head.status === "resolved"
        ? "Decision recorded"
        : "Decision withdrawn";
  const deniedMessage = accessFailure
    ? "Access could not be verified. Try again after the relay is available."
    : !checksReady
      ? "Checking whether you can respond…"
      : (deniedReason ?? "");
  const actorView = (
    pubkey: string | undefined | null,
  ): OutcomeActorView | null =>
    pubkey
      ? {
          pubkey,
          name: resolveUserLabel({ pubkey, currentPubkey, profiles }),
          isAgent: profiles?.[normalizePubkey(pubkey)]?.isAgent === true,
        }
      : null;
  const resolver = actorView(head.resolution?.resolvedByPubkey);
  const canceller = actorView(head.cancellation?.cancelledByPubkey);
  const askerView: OutcomeActorView = {
    pubkey: head.askerPubkey,
    name: asker,
    isAgent: askerIsAgent,
  };
  const addresseeName = head.ask.addresseePubkey
    ? resolveUserLabel({
        pubkey: head.ask.addresseePubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: Boolean(
          profiles?.[normalizePubkey(head.ask.addresseePubkey)],
        ),
      })
    : null;
  const discussion =
    showDiscussionLink && head.ask.threadRootEventId
      ? { channelId, rootId: head.ask.threadRootEventId }
      : null;
  const detailLink = (
    <Link
      className="colony-outcome-button"
      data-testid="ask-detail-link"
      params={{ askId, channelId }}
      to="/asks/$channelId/$askId"
    >
      Open decision
    </Link>
  );
  const conversationLink = (
    <Link
      className="colony-outcome-link"
      params={{ channelId }}
      search={{
        messageId: head.ask.threadRootEventId,
        threadRootId: head.ask.threadRootEventId,
        thread: head.ask.threadRootEventId,
      }}
      to="/channels/$channelId"
    >
      Open conversation
    </Link>
  );

  const allowanceProposal = head.ask.spendAllowanceProposal;
  const allowanceValue =
    allowanceProposal?.temporaryAllowance?.allowance ??
    allowanceProposal?.allowance;
  const tiles =
    allowanceProposal && allowanceValue
      ? [
          {
            label: "Employee",
            value: resolveUserLabel({
              pubkey: allowanceProposal.employeePubkey,
              currentPubkey,
              profiles,
              preferResolvedSelfLabel: Boolean(
                profiles?.[normalizePubkey(allowanceProposal.employeePubkey)],
              ),
            }),
          },
          {
            label: "Requested allowance",
            value: `${formatUsdCents(allowanceValue.amountCents)} / ${allowanceValue.period}`,
          },
          {
            label: "Duration",
            value: allowanceProposal.temporaryAllowance
              ? "Temporary"
              : "Permanent",
          },
          ...(allowanceProposal.temporaryAllowance
            ? [
                {
                  label: "End date",
                  value:
                    formatTileDate(
                      allowanceProposal.temporaryAllowance.expiresAt,
                    ) ??
                    allowanceProposal.temporaryAllowance.expiresAt.slice(0, 10),
                },
              ]
            : []),
        ]
      : null;

  const hireProposal = head.ask.hireProposal;
  const hireDeclinedInThread =
    kind === "hire" &&
    showDetailLink &&
    head.status === "resolved" &&
    head.resolution?.outcome === "rejected";
  if (
    specializedDetail &&
    kind === "hire" &&
    hireProposal &&
    !hireDeclinedInThread
  ) {
    return (
      <HireAskCard
        accessFailure={accessFailure}
        askId={askId}
        askerIsAgent={askerIsAgent}
        channelId={channelId}
        channelName={channelName}
        checksReady={checksReady}
        currentPubkey={currentPubkey}
        deniedReason={deniedReason}
        headRecord={headRecord}
        hireProposal={hireProposal}
        isOverdue={isOverdue}
        membershipRole={membershipQuery.data?.role}
        needsYou={needsYou}
        profiles={profiles}
        statusText={statusText}
        key={askId}
      />
    );
  }

  const dutyProposal = head.ask.dutyProposal;
  if (specializedDetail && kind === "duty" && dutyProposal) {
    return (
      <DutyAskCard
        accessFailure={accessFailure}
        askId={askId}
        askerIsAgent={askerIsAgent}
        channelId={channelId}
        channelName={channelName}
        checksReady={checksReady}
        currentPubkey={currentPubkey}
        deniedReason={deniedReason}
        headRecord={headRecord}
        isOverdue={isOverdue}
        needsYou={needsYou}
        profiles={profiles}
        query={query}
        statusText={statusText}
        key={askId}
      />
    );
  }

  const statusChip: OutcomeChip = isOverdue
    ? { label: "Overdue · still open", tone: "bad", icon: null }
    : head.status === "resolved" && head.resolution
      ? (describeOutcome(head)?.chip ?? {
          label: statusText,
          tone: "idle",
          icon: null,
        })
      : {
          label: head.status.charAt(0).toUpperCase() + head.status.slice(1),
          tone: "idle",
          icon: null,
        };

  // The decision pages: the Decision page and the Funding decision page.
  if (!showDetailLink) {
    const funding = kind === "funding" || kind === "tool";
    const workItemId =
      head.ask.subject?.kind === "workItem" ? head.ask.subject.id : null;
    const renderDetail = (
      linkedWork: LinkedWorkView | null,
      extraProfiles: UserProfileLookup,
    ) => {
      const merged = { ...extraProfiles, ...profiles };
      const model: DecisionDetailModel = {
        variant: funding ? "funding" : "general",
        record: headRecord,
        typeText: typeLabel(head.ask.type),
        specializedKind: kind,
        asker: askerView,
        raisedClock: formatClockTime(head.createdAt),
        channelName,
        needsYou,
        statusChip,
        decisionHeading,
        addressee: head.ask.addresseePubkey
          ? { pubkey: head.ask.addresseePubkey, name: addresseeName ?? "" }
          : null,
        deadlineSentence: formatDeadline(head.ask.decideBy, {
          lowercaseDay: true,
        }),
        deadlineLabel: formatDeadline(head.ask.decideBy),
        overdue: isOverdue,
        linkedWork,
        tiles,
        toolPreview: head.ask.toolConsent?.actionPreview ?? null,
        canRespond: checksReady && !deniedReason,
        deniedMessage,
        accessFailure,
        resolver,
        canceller,
        profiles: merged,
        liveUnavailable: liveState === "unavailable",
        discussion,
        notice:
          head.ask.category === "money"
            ? "Only an authorized human may resolve spending decisions."
            : funding
              ? "Only an authorized human may resolve this ask."
              : null,
        leading,
      };
      return <AskDecisionDetail model={model} />;
    };
    return workItemId ? (
      <WithLinkedWork askChannelId={channelId} workItemId={workItemId}>
        {renderDetail}
      </WithLinkedWork>
    ) : (
      renderDetail(null, {})
    );
  }

  // In a thread: an open ask the viewer can answer keeps its form inline.
  const inlineForm =
    head.status === "open" &&
    !specializedVariant &&
    checksReady &&
    !deniedReason;
  const inlineDenied =
    head.status === "open" && !specializedVariant && !inlineForm;

  if (inlineForm || inlineDenied) {
    return (
      <section
        aria-label={`${typeLabel(head.ask.type)} ask`}
        className="colony-ask-card"
        data-ask-id={askId}
        data-testid="ask-card"
      >
        <div className="colony-ask-meta">
          <span
            className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
            data-testid="ask-status"
          >
            {statusText}
          </span>
          <span>{head.ask.type}</span>
          {head.ask.decideBy ? (
            <span>
              Decide by {formatAskDate(head.ask.decideBy) ?? head.ask.decideBy}
            </span>
          ) : null}
        </div>
        <h2>{head.ask.title}</h2>
        {head.ask.body ? (
          <p className="colony-ask-body">{head.ask.body}</p>
        ) : null}
        {head.ask.toolConsent ? (
          <p className="colony-ask-body" data-testid="tool-consent-preview">
            {head.ask.toolConsent.actionPreview}
          </p>
        ) : null}
        {head.ask.addresseePubkey ? (
          <p className="colony-ask-addressed">
            Addressed to {addresseeName}.{" "}
            {head.ask.category === "money"
              ? "Only an authorized human may resolve spending decisions."
              : head.ask.category === "general"
                ? "The named recipient can respond."
                : "Only an authorized human may resolve this ask."}
          </p>
        ) : null}
        {inlineForm ? (
          <AskResponseForm record={headRecord} />
        ) : (
          <div
            className="colony-ask-denied"
            data-testid="ask-cannot-resolve"
            role={accessFailure ? "alert" : "status"}
          >
            <strong>You can view this ask, but cannot respond.</strong>
            <p>{deniedMessage}</p>
          </div>
        )}
        {liveState === "unavailable" ? (
          <p className="colony-ask-live-status" role="status">
            Live updates are unavailable. The ask will refresh when the relay
            reconnects.
          </p>
        ) : null}
        <Link
          className="colony-ask-detail-link"
          data-testid="ask-detail-link"
          params={{ askId, channelId }}
          to="/asks/$channelId/$askId"
        >
          Open decision
        </Link>
      </section>
    );
  }

  // Every other state of an ask in a thread is an outcome card.
  return (
    <AskThreadOutcomeCard
      accessFailure={accessFailure}
      askId={askId}
      asker={askerView}
      canAnswer={checksReady && !deniedReason}
      canceller={canceller}
      conversationLink={conversationLink}
      deniedMessage={deniedMessage}
      detailLink={detailLink}
      head={head}
      isOverdue={isOverdue}
      kind={kind}
      liveUnavailable={liveState === "unavailable"}
      profiles={profiles}
      resolver={resolver}
      titleLink={(text) => (
        <Link
          className="colony-outcome-title-link"
          data-testid="ask-detail-link"
          params={{ askId, channelId }}
          to="/asks/$channelId/$askId"
        >
          {text}
        </Link>
      )}
    />
  );
}
