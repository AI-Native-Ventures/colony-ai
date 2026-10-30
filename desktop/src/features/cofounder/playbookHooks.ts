import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";

import {
  buildPlaybookActionEvent,
  buildPlaybookJobActionEvent,
} from "./playbookActions";
import type {
  PlaybookActionInput,
  PlaybookJobActionInput,
} from "./playbookActions";
import {
  KIND_PLAYBOOK_ACTION,
  KIND_PLAYBOOK_HEAD,
  jobsOfPlaybook,
  latestJobs,
  latestPlaybooks,
  parsePlaybookHead,
  parsePlaybookJobHead,
  playbookRecordKind,
} from "./playbookRecords";
import type { JobView, PlaybookView } from "./playbookRecords";

export type PlaybooksData = { playbooks: PlaybookView[]; jobs: JobView[] };

export const playbooksQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-playbooks", communityId, relayUrl] as const;

async function fetchPlaybooks(): Promise<PlaybooksData> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  // One query reads both families; the d tag tells them apart.
  const events = await relayClient.fetchEvents({
    kinds: [KIND_PLAYBOOK_HEAD],
    authors: [relaySelf],
    limit: 500,
  });
  const playbooks = [];
  const jobs = [];
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const family = playbookRecordKind(dTag);
    if (family === "playbook") {
      const playbook = parsePlaybookHead(event, relaySelf);
      if (playbook) playbooks.push({ playbook, createdAt: event.created_at });
    } else if (family === "job") {
      const job = parsePlaybookJobHead(event, relaySelf);
      if (job) jobs.push({ job, createdAt: event.created_at });
    }
  }
  return { playbooks: latestPlaybooks(playbooks), jobs: latestJobs(jobs) };
}

/** Every playbook and every running copy of the company, newest change first. */
export function usePlaybooksQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: playbooksQueryKey(communityId, relayUrl),
    queryFn: fetchPlaybooks,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** One playbook with its running copies. */
export function usePlaybookQuery(playbookId: string | null) {
  const query = usePlaybooksQuery(playbookId !== null);
  const playbook = useMemo(
    () =>
      query.data?.playbooks.find(
        (candidate) => candidate.playbookId === playbookId,
      ) ?? null,
    [query.data, playbookId],
  );
  const jobs = useMemo(
    () =>
      playbookId && query.data
        ? jobsOfPlaybook(query.data.jobs, playbookId)
        : [],
    [query.data, playbookId],
  );
  return { ...query, playbook, jobs };
}

function usePublishPlaybookEvent<Input>(
  build: (input: Input) => { content: string; tags: string[][] },
) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: Input) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = build(input);
      const event = await signRelayEvent({
        kind: KIND_PLAYBOOK_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the playbook.",
        "Failed to save the playbook.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: playbooksQueryKey(communityId, relayUrl),
      });
    },
  });
}

/** One mutation for every playbook write: sign, publish, refresh the list. */
export function usePlaybookAction() {
  return usePublishPlaybookEvent<PlaybookActionInput>(buildPlaybookActionEvent);
}

/** One mutation for every running-copy write: sign, publish, refresh the list. */
export function usePlaybookJobAction() {
  return usePublishPlaybookEvent<PlaybookJobActionInput>(
    buildPlaybookJobActionEvent,
  );
}
