import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { buildGoalLink } from "@/shared/lib/entityLink";
import { Button } from "@/shared/ui/button";
import { useGoalHeadQuery } from "../goalRelay";
import { GoalReferenceCard } from "./GoalReferenceCard";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

const DEFAULT_MESSAGE = "Here is the outcome we’re working towards.";

export function GoalShareScreen({ goalId }: { goalId: string }) {
  const goalQuery = useGoalHeadQuery(goalId);
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const sendMutation = useSendMessageMutation(null, identityQuery.data);
  const { goChannel, goGoal } = useAppNavigation();
  const streamChannels = React.useMemo(
    () =>
      (channelsQuery.data ?? []).filter(
        (channel) => channel.channelType === "stream",
      ),
    [channelsQuery.data],
  );
  const [channelId, setChannelId] = React.useState("");
  const [message, setMessage] = React.useState(DEFAULT_MESSAGE);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!channelId && streamChannels.length > 0 && channelsQuery.isSuccess) {
      const linkedChannelId = goalQuery.data?.head.goal?.linkedChannelIds.find(
        (id) => streamChannels.some((channel) => channel.id === id),
      );
      setChannelId(linkedChannelId ?? streamChannels[0].id);
    }
  }, [channelId, channelsQuery.isSuccess, goalQuery.data, streamChannels]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const channel = streamChannels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel || !identityQuery.data || !goalQuery.data?.head.goal) return;

    const content = [message.trim(), buildGoalLink(goalId)]
      .filter(Boolean)
      .join("\n\n");
    setFormError(null);
    try {
      await sendMutation.mutateAsync({
        channelId: channel.id,
        targetChannel: channel,
        content,
      });
      await goChannel(channel.id);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The goal reference could not be posted.",
      );
    }
  };

  const goBack = () => void goGoal(goalId);

  if (
    goalQuery.isPending ||
    channelsQuery.isPending ||
    identityQuery.isPending
  ) {
    return (
      <>
        <GoalRouteHeader title="Reference this goal" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal reference
        </div>
      </>
    );
  }

  if (goalQuery.isError || channelsQuery.isError || identityQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={goBack} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            The goal, conversations or identity could not be loaded.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {goalQuery.isError ? (
              <Button
                onClick={() => void goalQuery.refetch()}
                variant="outline"
              >
                Try loading the goal again
              </Button>
            ) : null}
            {channelsQuery.isError ? (
              <Button
                onClick={() => void channelsQuery.refetch()}
                variant="outline"
              >
                Try loading conversations again
              </Button>
            ) : null}
            {identityQuery.isError ? (
              <Button
                onClick={() => void identityQuery.refetch()}
                variant="outline"
              >
                Try loading your identity again
              </Button>
            ) : null}
          </div>
        </main>
      </>
    );
  }

  if (!goalQuery.data?.head.goal || goalQuery.data.head.status === "deleted") {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={goBack} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            This goal is unavailable and cannot be referenced.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <GoalRouteHeader title="Reference this goal" />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-share-screen"
      >
        <GoalRouteBackLink onClick={goBack} />
        <h1 className="text-2xl font-bold tracking-tight">
          Reference this goal
        </h1>
        <div className="mt-5 max-w-[740px]">
          <GoalReferenceCard goalId={goalId} interactive={false} />
        </div>
        <form
          className="mt-6 max-w-[740px]"
          onSubmit={(event) => void onSubmit(event)}
        >
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-share-channel"
          >
            Conversation
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3 text-sm font-normal"
              disabled={streamChannels.length === 0}
              id="goal-share-channel"
              onChange={(event) => {
                setFormError(null);
                setChannelId(event.currentTarget.value);
              }}
              required
              value={channelId}
            >
              {streamChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          {channelsQuery.isSuccess && streamChannels.length === 0 ? (
            <p className="mb-5 text-sm text-muted-foreground">
              No conversations are available for this goal.
            </p>
          ) : null}
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-share-message"
          >
            Message
            <textarea
              className="min-h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="goal-share-message"
              maxLength={4000}
              onChange={(event) => {
                setFormError(null);
                setMessage(event.currentTarget.value);
              }}
              value={message}
            />
          </label>
          <p className="mb-5 text-xs leading-5 text-muted-foreground">
            The card links to this exact goal. A sub-goal keeps its own identity
            and parent relationship.
          </p>
          {formError ? (
            <p
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t border-border pt-5">
            <Button
              className="bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
              disabled={
                !channelId ||
                streamChannels.length === 0 ||
                sendMutation.isPending
              }
              type="submit"
            >
              {sendMutation.isPending ? "Posting reference" : "Post reference"}
            </Button>
            <Button onClick={goBack} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
