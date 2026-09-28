import * as React from "react";
import { useQueries } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { channelMembersQueryKey } from "@/features/channels/rosterFreshness";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getChannelMembers } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";
import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  useCompanyWorkActionMutation,
  useCompanyWorkHeadsQuery,
} from "../hooks";
import {
  COMPANY_WORK_SCHEMA_VERSION,
  type CompanyWorkAction,
  type CompanyWorkInput,
} from "../companyWorkModels";
import {
  hasSameCompanyWorkAudience,
  parseCompanyWorkThreadRoots,
  type CompanyWorkThreadRoot,
} from "../companyWorkMove";
import {
  companyWorkPrimaryButtonClass,
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
  CompanyWorkStatusBadge,
} from "./CompanyWorkPresentation";

const MOVE_ROOT_QUERY_LIMIT = 500;

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The move request could not be completed.";
}

function channelPeopleLabel(channel: Channel) {
  const people = channel.participants.filter(Boolean).slice(0, 4);
  if (people.length === 0) return `${channel.memberCount} people`;
  return `${people.join(", ")}${channel.memberCount > people.length ? ", …" : ""}`;
}

function sameChannelAudience(source: Channel, destination: Channel) {
  if (source.visibility !== destination.visibility) return false;
  const sourceMembers = source.memberPubkeys
    .map((pubkey) => pubkey.toLowerCase())
    .sort();
  const destinationMembers = destination.memberPubkeys
    .map((pubkey) => pubkey.toLowerCase())
    .sort();
  return (
    sourceMembers.length === destinationMembers.length &&
    sourceMembers.every((pubkey, index) => pubkey === destinationMembers[index])
  );
}

function threadTitle(root: CompanyWorkThreadRoot) {
  return root.preview;
}

export function CompanyWorkMoveScreen({ workItemId }: { workItemId: string }) {
  const { activeCommunity } = useCommunities();
  const channelsQuery = useChannelsQuery();
  const headsQuery = useCompanyWorkHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const mutation = useCompanyWorkActionMutation();
  const { goCompanyWorkDetail } = useAppNavigation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const channels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.isMember &&
      channel.archivedAt === null,
  );
  const channelIds = React.useMemo(
    () => channels.map((channel) => channel.id.toLowerCase()).sort(),
    [channels],
  );
  const rootsQuery = useQueries({
    queries: [
      {
        enabled: Boolean(
          record && activeCommunity?.relayUrl && channelIds.length,
        ),
        queryKey: [
          "company-work-move-roots",
          activeCommunity?.relayUrl ?? null,
          channelIds.join(","),
        ],
        queryFn: async () => {
          const events = await relayClient.fetchEvents({
            kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
            "#h": channelIds,
            limit: MOVE_ROOT_QUERY_LIMIT + 1,
          });
          if (events.length > MOVE_ROOT_QUERY_LIMIT) {
            throw new Error(
              "Too many conversation threads are available to move this work safely.",
            );
          }
          return parseCompanyWorkThreadRoots(events, channels);
        },
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
    ],
  })[0];
  const roots = rootsQuery.data ?? [];
  const [search, setSearch] = React.useState("");
  const [selectedRootId, setSelectedRootId] = React.useState<string | null>(
    null,
  );
  const [confirming, setConfirming] = React.useState(false);
  const currentPubkey = identityQuery.data?.pubkey.toLowerCase();
  const head = record?.head;
  const sourceChannel = channels.find(
    (channel) => channel.id === record?.channelId,
  );
  const selectedRoot = roots.find(
    (root) => root.event.id.toLowerCase() === selectedRootId,
  );
  const sourceRoot = roots.find(
    (root) =>
      root.event.id.toLowerCase() === head?.threadRootEventId?.toLowerCase(),
  );
  const currentRootId = head?.threadRootEventId?.toLowerCase() ?? null;
  const isCurrentDestination = (root: CompanyWorkThreadRoot) =>
    root.channel.id === record?.channelId &&
    root.event.id.toLowerCase() === currentRootId;
  const hasAuthority = Boolean(
    currentPubkey &&
      (head?.assignedPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === currentPubkey,
      ) ||
        head?.requesterPubkey.toLowerCase() === currentPubkey ||
        membershipQuery.data?.role === "owner" ||
        membershipQuery.data?.role === "admin"),
  );

  const rosterChannelIds = React.useMemo(
    () =>
      [
        ...new Set(
          [record?.channelId, selectedRoot?.channel.id].filter(Boolean),
        ),
      ]
        .map((channelId) => channelId as string)
        .sort(),
    [record?.channelId, selectedRoot?.channel.id],
  );
  const rosterQueries = useQueries({
    queries: rosterChannelIds.map((channelId) => ({
      queryKey: channelMembersQueryKey(channelId),
      queryFn: () => getChannelMembers(channelId),
      staleTime: 5 * 60_000,
    })),
  });
  const rostersByChannel = new Map(
    rosterChannelIds.map((channelId, index) => [
      channelId,
      rosterQueries[index],
    ]),
  );
  const sourceRoster = record
    ? rostersByChannel.get(record.channelId)
    : undefined;
  const destinationRoster = selectedRoot
    ? rostersByChannel.get(selectedRoot.channel.id)
    : undefined;
  const roleAudienceIsSame =
    sourceChannel &&
    selectedRoot &&
    sourceRoster?.data &&
    destinationRoster?.data
      ? hasSameCompanyWorkAudience(
          sourceChannel,
          selectedRoot.channel,
          sourceRoster.data,
          destinationRoster.data,
        )
      : null;
  const rosterUnavailable = Boolean(
    sourceRoster?.isError || destinationRoster?.isError,
  );
  const rosterPending = Boolean(
    sourceRoster?.isPending || destinationRoster?.isPending,
  );
  const people = React.useMemo(
    () => [
      ...new Set(
        [...(head?.assignedPubkeys ?? []), head?.requesterPubkey].filter(
          (pubkey): pubkey is string => Boolean(pubkey),
        ),
      ),
    ],
    [head],
  );
  const profilesQuery = useUsersBatchQuery(people);
  const profiles = profilesQuery.data?.profiles;
  const ownerLabel = head
    ? resolveUserLabel({
        currentPubkey,
        profiles,
        pubkey: head.assignedPubkeys[0] ?? "",
        preferResolvedSelfLabel: true,
      })
    : "";
  const requesterLabel = head
    ? resolveUserLabel({
        currentPubkey,
        profiles,
        pubkey: head.requesterPubkey,
        preferResolvedSelfLabel: true,
      })
    : "";
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleRoots = roots.filter((root) =>
    `${root.preview} ${root.channel.name} ${channelPeopleLabel(root.channel)}`
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
  const sameAudienceByMetadata = Boolean(
    sourceChannel &&
      selectedRoot &&
      sameChannelAudience(sourceChannel, selectedRoot.channel),
  );
  const canReviewMove = Boolean(
    selectedRoot &&
      sameAudienceByMetadata &&
      roleAudienceIsSame === true &&
      !rosterUnavailable &&
      !rosterPending,
  );

  const moveWorkItem = async () => {
    if (!record || !head || !selectedRoot || !canReviewMove) return;
    const nextHead: CompanyWorkInput = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId: head.workItemId,
      title: head.title,
      status: head.status,
      assignedPubkeys: head.assignedPubkeys,
      approverPubkeys: head.approverPubkeys,
      deliverables: head.deliverables,
      requesterPubkey: head.requesterPubkey,
      doneCondition: head.doneCondition,
      ...(head.goalId ? { goalId: head.goalId } : {}),
      ...(head.sourceEventId ? { sourceEventId: head.sourceEventId } : {}),
      threadRootEventId: selectedRoot.event.id,
      ...(head.evidence ? { evidence: head.evidence } : {}),
    };
    const action: CompanyWorkAction = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId: head.workItemId,
      action: "update",
      expectedHeadEventId: record.event.id,
      head: nextHead,
    };
    try {
      await mutation.mutateAsync({ channelId: record.channelId, action });
      await goCompanyWorkDetail(workItemId, { replace: true });
    } catch {
      const refreshed = await headsQuery.refetch();
      const latest = refreshed.data?.find(
        (candidate) => candidate.head.workItemId === workItemId,
      );
      if (
        latest?.channelId === selectedRoot.channel.id &&
        latest.head.threadRootEventId?.toLowerCase() ===
          selectedRoot.event.id.toLowerCase()
      ) {
        await goCompanyWorkDetail(workItemId, { replace: true });
      }
    }
  };

  const onCancel = () => void goCompanyWorkDetail(workItemId);

  if (
    headsQuery.isPending ||
    channelsQuery.isPending ||
    identityQuery.isPending
  ) {
    return (
      <>
        <CompanyWorkPageHeader title="Move work to another thread" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </>
    );
  }

  if (headsQuery.isError || channelsQuery.isError || identityQuery.isError) {
    return (
      <>
        <CompanyWorkPageHeader title="Move work to another thread" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Move work to another thread
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">Work item unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {headsQuery.isError
                ? errorText(headsQuery.error)
                : channelsQuery.isError
                  ? "Conversations could not be loaded."
                  : "Your identity could not be loaded."}
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                void headsQuery.refetch();
                void channelsQuery.refetch();
                void identityQuery.refetch();
              }}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </main>
      </>
    );
  }

  if (!record || !head || !sourceChannel || !hasAuthority) {
    return (
      <>
        <CompanyWorkPageHeader title="Move work to another thread" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Move work to another thread
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              {!record || !sourceChannel
                ? "Work item unavailable"
                : "You cannot move this work item"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {!record || !sourceChannel
                ? "This work item is not available in the current conversations."
                : "Only the work owner, requester, or a community owner or admin can move it."}
            </p>
          </div>
        </main>
      </>
    );
  }

  if (head.status === "archived") {
    return (
      <>
        <CompanyWorkPageHeader title="Move work to another thread" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Move work to another thread
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              Archived work cannot be moved.
            </h2>
          </div>
        </main>
      </>
    );
  }

  const currentChannelRoot = sourceRoot
    ? threadTitle(sourceRoot)
    : "No thread linked";
  const actionError = mutation.isError ? errorText(mutation.error) : null;

  return (
    <>
      <CompanyWorkPageHeader
        title={
          confirming ? "Move this work item?" : "Move work to another thread"
        }
      />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="company-work-move"
      >
        <CompanyWorkBackButton
          label="Back"
          onClick={confirming ? () => setConfirming(false) : onCancel}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          {confirming ? "Move this work item?" : "Move work to another thread"}
        </h1>
        <section className="mt-7 max-w-[760px] rounded-xl border border-border p-6">
          <div className="border-b border-border pb-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Work item
            </p>
            <h2 className="mt-3 text-base font-semibold">{head.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <CompanyWorkStatusBadge status={head.status} />
              <span>Owner: {ownerLabel}</span>
              <span>Requested by {requesterLabel}</span>
            </div>
          </div>

          {confirming && selectedRoot ? (
            <div className="pt-5">
              {actionError ? (
                <div
                  className="mb-5 rounded-lg border border-[#a45e6b]/30 bg-[#a45e6b]/[0.06] p-4"
                  data-testid="company-work-move-failure"
                  role="alert"
                >
                  <strong className="block text-sm text-[#965562] dark:text-[#d99aa6]">
                    The work item has not moved.
                  </strong>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {actionError} The destination is kept. Retry safely after
                    checking the reason.
                  </p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <p className="text-2xs font-medium uppercase text-muted-foreground">
                    From
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {currentChannelRoot}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{sourceChannel.name}
                  </p>
                </div>
                <div className="rounded-lg border border-[#76608c]/60 bg-[#eee7f4] p-4 dark:bg-[#403449]">
                  <p className="text-2xs font-medium uppercase text-muted-foreground">
                    To
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {threadTitle(selectedRoot)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{selectedRoot.channel.name} ·{" "}
                    {channelPeopleLabel(selectedRoot.channel)}
                  </p>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                The work ID, owner, goal, status and history stay the same.
                Messages and attachments remain in the original discussion, with
                a link to the new location.
              </p>
              <div className="mt-5 rounded-lg border-l-4 border-[#76608c] bg-muted/40 p-4">
                <strong className="text-sm">Same audience</strong>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceChannel.id === selectedRoot.channel.id
                    ? `Both threads are in #${sourceChannel.name}. No membership or permissions will change.`
                    : `Both conversations have the same members and roles. No membership or permissions will change.`}
                </p>
              </div>
              {rosterUnavailable ? (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  Channel permissions could not be checked. Retry after the
                  membership data is available.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  className={companyWorkPrimaryButtonClass}
                  disabled={!canReviewMove || mutation.isPending}
                  onClick={() => void moveWorkItem()}
                >
                  {mutation.isPending
                    ? "Moving work item"
                    : actionError
                      ? "Retry move"
                      : "Move work item"}
                </Button>
                <Button
                  disabled={mutation.isPending}
                  onClick={() => setConfirming(false)}
                  variant="outline"
                >
                  Back
                </Button>
                <Button
                  disabled={mutation.isPending}
                  onClick={onCancel}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="pt-5">
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor="company-work-move-search"
              >
                Find a thread
                <Input
                  autoComplete="off"
                  data-testid="company-work-move-search"
                  id="company-work-move-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by thread or channel"
                  value={search}
                />
              </label>
              {rootsQuery.isPending ? (
                <p className="mt-4 text-sm text-muted-foreground" role="status">
                  Loading accessible threads
                </p>
              ) : rootsQuery.isError ? (
                <div className="mt-4 rounded-lg border border-border p-4">
                  <p className="text-sm text-muted-foreground">
                    {errorText(rootsQuery.error)}
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => void rootsQuery.refetch()}
                    variant="outline"
                  >
                    Try again
                  </Button>
                </div>
              ) : visibleRoots.length > 0 ? (
                <ul
                  className="mt-4 grid gap-2"
                  data-testid="company-work-move-roots"
                >
                  {visibleRoots.map((root) => {
                    const current = isCurrentDestination(root);
                    const sameAudience = sameChannelAudience(
                      sourceChannel,
                      root.channel,
                    );
                    const disabled = current || !sameAudience;
                    const selected =
                      root.event.id.toLowerCase() === selectedRootId;
                    return (
                      <li key={root.event.id}>
                        <button
                          aria-pressed={selected}
                          className={`flex min-h-[84px] w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-[#76608c] bg-[#eee7f4] dark:bg-[#403449]" : "border-border bg-background hover:bg-muted/40"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                          data-testid={`company-work-move-root-${root.event.id}`}
                          disabled={disabled}
                          onClick={() => {
                            setSelectedRootId(root.event.id.toLowerCase());
                            setConfirming(false);
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="text-lg text-muted-foreground"
                          >
                            #
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {threadTitle(root)}
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              #{root.channel.name} ·{" "}
                              {channelPeopleLabel(root.channel)}
                            </span>
                            {current ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                Current thread
                              </span>
                            ) : !sameAudience ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                Cannot move here: audience would change
                              </span>
                            ) : null}
                          </span>
                          {current ? (
                            <span className="text-xs text-muted-foreground">
                              Current
                            </span>
                          ) : (
                            <span
                              aria-hidden="true"
                              className="text-lg text-muted-foreground"
                            >
                              ›
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div
                  className="mt-4 rounded-lg border border-border px-4 py-8 text-center"
                  data-testid="company-work-move-empty"
                >
                  <h3 className="text-sm font-semibold">
                    No accessible threads found
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try another search or return to the work item.
                  </p>
                </div>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                Choose an existing thread you can access. A move cannot silently
                change who can see the work.
              </p>
              {selectedRoot && rosterPending ? (
                <p className="mt-3 text-xs text-muted-foreground" role="status">
                  Checking membership and roles…
                </p>
              ) : null}
              {selectedRoot && roleAudienceIsSame === false ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  Cannot move here because channel permissions would change.
                </p>
              ) : null}
              {selectedRoot && rosterUnavailable ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  Channel permissions are unavailable. Try again.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  className={companyWorkPrimaryButtonClass}
                  disabled={!canReviewMove}
                  onClick={() => setConfirming(true)}
                >
                  Review move
                </Button>
                <Button onClick={onCancel} variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
