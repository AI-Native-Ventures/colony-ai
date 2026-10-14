import { Link } from "@tanstack/react-router";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useRelayAgentsQuery } from "@/features/agents/hooks";
import { useClientRecordsQuery } from "@/features/clients/useBusinessRecords";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { useAskHeadQuery } from "../hooks";
import type { AskHeadQueryState } from "../hooks";
import { mapSpecializedAskCard } from "../askCardMapping";
import { DutyAskCard } from "./DutyAskCard";
import { HireAskCard } from "./HireAskCard";
import { AskResponseForm } from "./AskResponseForm";
import { formatAskDate } from "./askCardFormatting";
import { formatUsdCents } from "@/features/power/spendModels";
import type { AskHead, AskOutcome, AskType } from "../askRecords";

function outcomeLabel(outcome: AskOutcome) {
  switch (outcome) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "revision_requested":
      return "Revision requested";
    case "answered":
      return "Answered";
    case "chosen":
      return "Choice recorded";
    case "confirmed":
      return "Checklist confirmed";
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
  }
}

function typeLabel(type: AskType) {
  if (type === "tool_consent") return "Tool consent";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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
    if (
      communityRole !== "owner" &&
      communityRole !== "admin" &&
      communityRole !== "partner"
    ) {
      return "Only company owners, partners and admins can decide this";
    }
    return null;
  }
  if (!channelMember) return "Only members of this conversation can answer";
  if (
    head.ask.memberProposal &&
    (communityRole === "owner" ||
      communityRole === "admin" ||
      communityRole === "partner")
  ) {
    return null;
  }
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

function AskResolution({
  head,
  currentPubkey,
  profiles,
}: {
  head: AskHead;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
}) {
  if (head.status === "cancelled" && head.cancellation) {
    const name = resolveUserLabel({
      pubkey: head.cancellation.cancelledByPubkey,
      currentPubkey,
      profiles,
    });
    return (
      <div className="colony-ask-resolution" data-testid="ask-cancelled">
        <strong>Cancelled by {name}</strong>
        <p>{head.cancellation.reason}</p>
        <small>{formatAskDate(head.cancellation.cancelledAt)}</small>
      </div>
    );
  }
  const resolution = head.resolution;
  if (head.status !== "resolved" || !resolution) return null;
  const name = resolveUserLabel({
    pubkey: resolution.resolvedByPubkey,
    currentPubkey,
    profiles,
  });
  const chosenOption = head.ask.options?.find(
    (option) => option.id === resolution.optionId,
  );
  const details =
    resolution.answer ??
    chosenOption?.label ??
    resolution.reason ??
    (resolution.checkedItemIds ? "All checklist items confirmed." : null);
  return (
    <div className="colony-ask-resolution" data-testid="ask-resolved">
      <strong>
        {outcomeLabel(resolution.outcome)} by {name}
      </strong>
      {details ? <p>{details}</p> : null}
      <small>{formatAskDate(resolution.resolvedAt)}</small>
    </div>
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
  questionViewer = false,
}: {
  askId: string;
  channelId: string | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  queryState?: AskHeadQueryState;
  showDetailLink?: boolean;
  lazyQueryEnabled?: boolean;
  questionViewer?: boolean;
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
  const workItemSubjectId =
    head?.ask.subject?.kind === "workItem" ? head.ask.subject.id : null;
  const subjectWorkQuery = useClientRecordsQuery(
    channelId,
    Boolean(workItemSubjectId),
  );
  const matchingWorkItems =
    workItemSubjectId && subjectWorkQuery.workItemsQuery.data
      ? subjectWorkQuery.workItemsQuery.data.filter(
          (workItem) =>
            workItem.value.clientId === channelId &&
            workItem.value.workItemId === workItemSubjectId,
        )
      : [];
  const linkedWorkItem =
    matchingWorkItems.length === 1 ? matchingWorkItems[0] : null;

  if (!channelId) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-unavailable"
      >
        <p role="status">Open this discussion to view the ask.</p>
      </section>
    );
  }
  if (
    relaySelfQuery.isError ||
    (relaySelfQuery.isSuccess && !relaySelfQuery.data)
  ) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-unavailable"
      >
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
      </section>
    );
  }
  if (relaySelfQuery.isPending) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-loading"
      >
        <p role="status">Checking the relay-signed ask…</p>
      </section>
    );
  }
  if (query.isPending) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-loading"
      >
        <p role="status">Loading the latest ask…</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-error"
      >
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
      </section>
    );
  }
  if (!head || !headRecord) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-missing"
      >
        <p role="status">This ask is no longer available.</p>
      </section>
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
  const showQuestionViewer =
    questionViewer &&
    head.ask.category === "general" &&
    (head.ask.type === "question" ||
      head.ask.type === "choice" ||
      head.ask.type === "checklist");
  const specializedDetail = Boolean(
    specializedVariant &&
      (!showDetailLink ||
        specializedVariant.kind === "hire" ||
        specializedVariant.kind === "duty"),
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
  const allowanceProposal = head.ask.spendAllowanceProposal;
  const allowanceValue =
    allowanceProposal?.temporaryAllowance?.allowance ??
    allowanceProposal?.allowance;
  const allowanceProposalDetails =
    allowanceProposal && allowanceValue ? (
      <dl
        className="colony-ask-money-proposal-details"
        data-testid="ask-money-allowance-proposal"
      >
        <div>
          <dt>Employee</dt>
          <dd>
            {resolveUserLabel({
              pubkey: allowanceProposal.employeePubkey,
              currentPubkey,
              profiles,
              preferResolvedSelfLabel: Boolean(
                profiles?.[normalizePubkey(allowanceProposal.employeePubkey)],
              ),
            })}
          </dd>
        </div>
        <div>
          <dt>Requested allowance</dt>
          <dd>
            {formatUsdCents(allowanceValue.amountCents)} /{" "}
            {allowanceValue.period}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {allowanceProposal.temporaryAllowance ? "Temporary" : "Permanent"}
          </dd>
        </div>
        {allowanceProposal.temporaryAllowance ? (
          <div>
            <dt>End date</dt>
            <dd>
              {allowanceProposal.temporaryAllowance.expiresAt.slice(0, 10)}
            </dd>
          </div>
        ) : null}
      </dl>
    ) : null;

  const hireProposal = head.ask.hireProposal;
  if (
    specializedDetail &&
    specializedVariant?.kind === "hire" &&
    hireProposal
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
  if (
    specializedDetail &&
    specializedVariant?.kind === "duty" &&
    dutyProposal
  ) {
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

  if (showQuestionViewer) {
    return (
      <section
        aria-label={`${typeLabel(head.ask.type)} ask`}
        className="colony-ask-card colony-ask-card-question-viewer"
        data-ask-id={askId}
        data-testid="ask-card"
      >
        <div className="colony-question-status-row">
          <span data-testid="ask-status">
            {needsYou ? "✓ Waiting for you" : statusText}
          </span>
          <time dateTime={head.createdAt}>
            {new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(Date.parse(head.createdAt)))}
          </time>
        </div>
        <span className="colony-question-kind">{typeLabel(head.ask.type)}</span>
        <h2>{head.ask.title}</h2>
        {head.ask.body ? (
          <p className="colony-question-body">{head.ask.body}</p>
        ) : null}
        {head.status === "open" ? (
          checksReady && !deniedReason ? (
            <AskResponseForm
              answerLabel="Answer"
              record={headRecord}
              submitLabel="Send answer"
            />
          ) : (
            <div
              className="colony-ask-denied"
              data-testid="ask-cannot-resolve"
              role={accessFailure ? "alert" : "status"}
            >
              <strong>You can view this ask, but cannot respond.</strong>
              <p>
                {accessFailure
                  ? "Access could not be verified. Try again after the relay is available."
                  : !checksReady
                    ? "Checking whether you can respond…"
                    : deniedReason}
              </p>
            </div>
          )
        ) : (
          <AskResolution
            currentPubkey={currentPubkey}
            head={head}
            profiles={profiles}
          />
        )}
        <div className="colony-question-author">
          <span aria-hidden="true">
            {askerIsAgent ? (
              <ColonyAntAvatar decorative name={asker} />
            ) : (
              <UserAvatar
                avatarUrl={askerProfile?.avatarUrl ?? null}
                displayName={asker}
                size="sm"
              />
            )}
          </span>
          <span>
            <strong>{asker}</strong>
            <small>{askerIsAgent ? "AI employee" : "Person"}</small>
          </span>
          <span className="colony-question-channel">In {channelName}</span>
        </div>
        {liveState === "unavailable" && head.status === "open" ? (
          <p className="colony-ask-live-status" role="status">
            Live updates are unavailable. The ask will refresh when the relay
            reconnects.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label={`${typeLabel(head.ask.type)} ask`}
      className={`colony-ask-card${specializedVariant ? ` colony-ask-card-${specializedVariant.kind}` : ""}${specializedDetail ? " colony-ask-card-specialized-detail" : ""}`}
      data-ask-id={askId}
      data-ask-variant={specializedVariant?.kind}
      data-testid="ask-card"
    >
      {specializedDetail ? (
        <div className="colony-ask-special-grid">
          <section
            aria-label="Decision requested"
            className="colony-ask-special-request"
          >
            <h2>Decision requested</h2>
            <header className="colony-ask-special-header">
              <div className="colony-ask-special-identity">
                <span aria-hidden="true">
                  {askerIsAgent ? (
                    <ColonyAntAvatar decorative name={asker} />
                  ) : (
                    <UserAvatar
                      avatarUrl={askerProfile?.avatarUrl ?? null}
                      displayName={asker}
                      size="md"
                    />
                  )}
                </span>
                <div>
                  <strong>{asker}</strong>
                  <p>
                    {askerIsAgent ? "AI employee" : "Person"} · #{channelName} ·{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(Date.parse(head.createdAt)))}
                  </p>
                </div>
              </div>
              <span
                className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
                data-testid="ask-status"
              >
                {needsYou ? "Needs you" : statusText}
              </span>
            </header>
            {head.ask.body ? (
              <p className="colony-ask-special-description">{head.ask.body}</p>
            ) : null}
            {allowanceProposalDetails}
            {head.ask.toolConsent ? (
              <p className="colony-ask-body" data-testid="tool-consent-preview">
                {head.ask.toolConsent.actionPreview}
              </p>
            ) : null}
            {head.status === "open" ? (
              checksReady && !deniedReason ? (
                <AskResponseForm record={headRecord} />
              ) : (
                <div
                  className="colony-ask-denied"
                  data-testid="ask-cannot-resolve"
                  role={accessFailure ? "alert" : "status"}
                >
                  <strong>You can view this ask, but cannot respond.</strong>
                  <p>
                    {accessFailure
                      ? "Access could not be verified. Try again after the relay is available."
                      : !checksReady
                        ? "Checking whether you can respond…"
                        : deniedReason}
                  </p>
                </div>
              )
            ) : (
              <AskResolution
                currentPubkey={currentPubkey}
                head={head}
                profiles={profiles}
              />
            )}
            {head.status !== "open" ? (
              <Link
                className="colony-ask-special-work-link"
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
            ) : null}
          </section>
          <aside
            aria-label="Decision context"
            className="colony-ask-special-context"
          >
            <h2>Decision context</h2>
            <dl>
              <div>
                <dt>Addressed to</dt>
                <dd>
                  {head.ask.addresseePubkey
                    ? resolveUserLabel({
                        pubkey: head.ask.addresseePubkey,
                        currentPubkey,
                        profiles,
                        preferResolvedSelfLabel: Boolean(
                          profiles?.[normalizePubkey(head.ask.addresseePubkey)],
                        ),
                      })
                    : "Owner or administrator"}
                </dd>
              </div>
              <div>
                <dt>Can decide</dt>
                <dd>Owner or administrator</dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>
                  {head.ask.decideBy
                    ? (formatAskDate(head.ask.decideBy) ?? head.ask.decideBy)
                    : "No deadline"}
                </dd>
              </div>
              {linkedWorkItem ? (
                <div>
                  <dt>Linked work</dt>
                  <dd>{linkedWorkItem.value.title}</dd>
                </div>
              ) : null}
            </dl>
            {linkedWorkItem ? (
              <Link
                aria-label={`Open work item ${linkedWorkItem.value.title}`}
                className="colony-ask-special-work-link"
                params={{ workId: linkedWorkItem.value.workItemId }}
                search={{ client: linkedWorkItem.value.clientId }}
                to="/work/$workId"
              >
                Open work
              </Link>
            ) : null}
          </aside>
        </div>
      ) : specializedVariant ? (
        <>
          <header className="colony-ask-special-header">
            <div className="colony-ask-special-identity">
              <span aria-hidden="true">
                {askerIsAgent ? (
                  <ColonyAntAvatar decorative name={asker} />
                ) : (
                  <UserAvatar
                    avatarUrl={askerProfile?.avatarUrl ?? null}
                    displayName={asker}
                    size="md"
                  />
                )}
              </span>
              <div>
                <h3>{decisionHeading}</h3>
                <p>
                  Proposed by {asker} ·{" "}
                  {askerIsAgent ? "AI employee" : "Person"} · #{channelName} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(Date.parse(head.createdAt)))}
                </p>
              </div>
            </div>
            <span
              className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
              data-testid="ask-status"
            >
              {needsYou ? "Needs you" : statusText}
            </span>
          </header>
          <dl className="colony-ask-special-context">
            <div>
              <dt>Addressed to</dt>
              <dd>
                {head.ask.addresseePubkey
                  ? resolveUserLabel({
                      pubkey: head.ask.addresseePubkey,
                      currentPubkey,
                      profiles,
                      preferResolvedSelfLabel: Boolean(
                        profiles?.[normalizePubkey(head.ask.addresseePubkey)],
                      ),
                    })
                  : "Owner or administrator"}
              </dd>
            </div>
            <div>
              <dt>Can decide</dt>
              <dd>Owner or administrator</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>
                {head.ask.decideBy
                  ? (formatAskDate(head.ask.decideBy) ?? head.ask.decideBy)
                  : "No deadline"}
              </dd>
            </div>
          </dl>
        </>
      ) : (
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
      )}
      {!specializedDetail ? (
        <>
          {specializedVariant ? (
            <p className="colony-ask-special-kind">
              {specializedVariant.decisionTitle}
            </p>
          ) : null}
          <h2>{head.ask.title}</h2>
          {head.ask.body ? (
            <p className="colony-ask-body">{head.ask.body}</p>
          ) : null}
          {allowanceProposalDetails}
          {head.ask.toolConsent ? (
            <p className="colony-ask-body" data-testid="tool-consent-preview">
              {head.ask.toolConsent.actionPreview}
            </p>
          ) : null}
          {!specializedVariant && head.ask.addresseePubkey ? (
            <p className="colony-ask-addressed">
              Addressed to{" "}
              {resolveUserLabel({
                pubkey: head.ask.addresseePubkey,
                currentPubkey,
                profiles,
                preferResolvedSelfLabel: Boolean(
                  profiles?.[normalizePubkey(head.ask.addresseePubkey)],
                ),
              })}
              .{" "}
              {head.ask.category === "money"
                ? "Only an authorized human may resolve spending decisions."
                : head.ask.category === "general"
                  ? "The named recipient can respond."
                  : "Only an authorized human may resolve this ask."}
            </p>
          ) : null}
          {head.status === "open" ? (
            checksReady && !deniedReason ? (
              <AskResponseForm record={headRecord} />
            ) : (
              <div
                className="colony-ask-denied"
                data-testid="ask-cannot-resolve"
                role={accessFailure ? "alert" : "status"}
              >
                <strong>You can view this ask, but cannot respond.</strong>
                <p>
                  {accessFailure
                    ? "Access could not be verified. Try again after the relay is available."
                    : !checksReady
                      ? "Checking whether you can respond…"
                      : deniedReason}
                </p>
              </div>
            )
          ) : (
            <AskResolution
              currentPubkey={currentPubkey}
              head={head}
              profiles={profiles}
            />
          )}
          {liveState === "unavailable" && head.status === "open" ? (
            <p className="colony-ask-live-status" role="status">
              Live updates are unavailable. The ask will refresh when the relay
              reconnects.
            </p>
          ) : null}
          {showDetailLink && channelId ? (
            <Link
              className="colony-ask-detail-link"
              data-testid="ask-detail-link"
              params={{ askId, channelId }}
              to="/asks/$channelId/$askId"
            >
              Open decision
            </Link>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
