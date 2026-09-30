import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useDutyActionMutation,
  useEmployeeDutiesQuery,
  validateReadableDutySchedule,
  type DutyHeadRecord,
  type DutyProposal,
} from "@/features/company-team/employeeDutiesLessons";
import {
  getWorkflowRunsPage,
  type WorkflowRunsPage,
} from "@/shared/api/tauriWorkflows";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";

type DutyView =
  | { kind: "list" }
  | { kind: "detail"; dutyId: string }
  | { kind: "edit"; dutyId: string }
  | { kind: "delete"; dutyId: string };

function displayStatus(status: string) {
  return status.replaceAll("_", " ");
}

function statusBadgeClass(status: string) {
  const isActive = status === "active" || status === "approved";
  return `normal-case tracking-normal border-transparent ${isActive ? "bg-colony-success/[0.12] text-colony-success" : "bg-colony-accent-soft text-colony-accent"}`;
}

function formatDutyTime(value: string | null, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function formatRunTime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1_000));
}

function isWorkflowConsistent(record: DutyHeadRecord, page: WorkflowRunsPage) {
  return (
    page.workflowDefinitionHash?.toLowerCase() ===
      record.head.workflowDefinitionHash.toLowerCase() &&
    page.workflowChannelId === record.head.proposal.channelId &&
    page.workflowEnabled === (record.head.status === "active")
  );
}

export function EmployeeDutiesPanel({
  employeePubkey,
  canManage,
}: {
  employeePubkey: string;
  canManage: boolean;
}) {
  const dutiesQuery = useEmployeeDutiesQuery(employeePubkey);
  const channelsQuery = useChannelsQuery({ enabled: true });
  const [view, setView] = React.useState<DutyView>({ kind: "list" });
  const [draft, setDraft] = React.useState<DutyProposal | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const mutation = useDutyActionMutation(employeePubkey);
  const selectedDutyId = view.kind === "list" ? null : view.dutyId;
  const record = dutiesQuery.data?.find(
    (item) => item.head.dutyId === selectedDutyId,
  );
  const workflowPageQuery = useQuery({
    queryKey: ["employee-duty-workflow-runs", selectedDutyId],
    queryFn: () => getWorkflowRunsPage(selectedDutyId as string, 100),
    enabled: view.kind === "detail" && selectedDutyId !== null,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const employeeChannels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType !== "dm" &&
      channel.archivedAt === null &&
      channel.memberPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === employeePubkey.toLowerCase(),
      ),
  );

  React.useEffect(() => {
    if (view.kind === "edit" && record) {
      setDraft(record.head.proposal);
      setError(null);
    }
  }, [record, view.kind]);

  async function submitDutyUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view.kind !== "edit" || !record || !draft || !canManage) return;
    setError(null);
    const scheduleCron = validateReadableDutySchedule(draft.scheduleText);
    if (!scheduleCron) {
      setError("Enter a supported recurring schedule.");
      return;
    }
    if (!employeeChannels.some((channel) => channel.id === draft.channelId)) {
      setError("Choose a channel where this employee is a member.");
      return;
    }
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        dutyId: record.head.dutyId,
        action: "update",
        expectedHeadEventId: record.event.id,
        proposal: { ...draft, scheduleCron },
      });
      setView({ kind: "detail", dutyId: record.head.dutyId });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The duty could not be saved.",
      );
    }
  }

  async function submitDutyLifecycle(action: "pause" | "resume" | "delete") {
    if (!record || !canManage) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        dutyId: record.head.dutyId,
        action,
        expectedHeadEventId: record.event.id,
      });
      setView(
        action === "delete"
          ? { kind: "list" }
          : { kind: "detail", dutyId: record.head.dutyId },
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The duty could not be updated.",
      );
    }
  }

  if (dutiesQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading duties
      </p>
    );
  }
  if (dutiesQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Duties could not be loaded</AlertTitle>
        <AlertDescription>{dutiesQuery.error.message}</AlertDescription>
      </Alert>
    );
  }
  if (dutiesQuery.subscriptionError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Duties may be out of date</AlertTitle>
        <AlertDescription>
          {dutiesQuery.subscriptionError.message}
        </AlertDescription>
      </Alert>
    );
  }
  if (selectedDutyId && !record) {
    return (
      <section data-testid="employee-duties">
        <Button
          className="mb-4 px-0"
          onClick={() => setView({ kind: "list" })}
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Back to duties
        </Button>
        <p className="text-sm text-muted-foreground">
          This duty is unavailable.
        </p>
      </section>
    );
  }

  if (view.kind === "edit" && record && draft) {
    return (
      <section className="max-w-[46rem]" data-testid="employee-duty-editor">
        <Button
          className="mb-4 px-0"
          onClick={() =>
            setView({ kind: "detail", dutyId: record.head.dutyId })
          }
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Duty
        </Button>
        <h2 className="mb-6 text-xl font-semibold tracking-tight">Edit duty</h2>
        <form
          className="space-y-4"
          onSubmit={(event) => void submitDutyUpdate(event)}
        >
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="duty-title"
          >
            <span>Duty</span>
            <Input
              id="duty-title"
              maxLength={180}
              onChange={(event) =>
                setDraft({ ...draft, title: event.currentTarget.value })
              }
              required
              value={draft.title}
            />
          </label>
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="duty-schedule"
          >
            <span>Schedule</span>
            <Input
              id="duty-schedule"
              maxLength={180}
              onChange={(event) =>
                setDraft({ ...draft, scheduleText: event.currentTarget.value })
              }
              required
              value={draft.scheduleText}
            />
          </label>
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="duty-channel"
          >
            <span>Channel</span>
            <select
              className="h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-sm"
              id="duty-channel"
              onChange={(event) =>
                setDraft({ ...draft, channelId: event.currentTarget.value })
              }
              required
              value={draft.channelId}
            >
              {employeeChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>
          <label
            className="block space-y-2 text-sm font-medium"
            htmlFor="duty-instructions"
          >
            <span>Instructions</span>
            <Textarea
              id="duty-instructions"
              maxLength={4000}
              onChange={(event) =>
                setDraft({ ...draft, instructions: event.currentTarget.value })
              }
              required
              value={draft.instructions}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Timezone: {draft.timeZone}. Existing permissions still apply to
            every run.
          </p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Saving" : "Save duty"}
            </Button>
            <Button
              onClick={() =>
                setView({ kind: "detail", dutyId: record.head.dutyId })
              }
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    );
  }

  if ((view.kind === "detail" || view.kind === "delete") && record) {
    const { head } = record;
    const channelName = channelsQuery.data?.find(
      (channel) => channel.id === head.proposal.channelId,
    )?.name;
    const workflowPage = workflowPageQuery.data;
    const consistent = workflowPage
      ? isWorkflowConsistent(record, workflowPage)
      : false;
    const latestRun = workflowPage?.runs[0];
    const lastRunTime = latestRun
      ? formatRunTime(latestRun.startedAt ?? latestRun.createdAt)
      : null;
    if (view.kind === "delete") {
      return (
        <section className="max-w-[46rem]" data-testid="employee-duty-delete">
          <Button
            className="mb-4 px-0"
            onClick={() => setView({ kind: "detail", dutyId: head.dutyId })}
            type="button"
            variant="link"
          >
            <ArrowLeft aria-hidden="true" /> Duty
          </Button>
          <div className="rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold">Delete this duty?</h2>
            <h3 className="mt-5 font-medium">{head.proposal.title}</h3>
            <p className="my-4 text-sm text-muted-foreground">
              Future runs stop. Existing run history and work stay available.
            </p>
            {error ? (
              <p className="mb-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!canManage || mutation.isPending}
                onClick={() => void submitDutyLifecycle("delete")}
                type="button"
                variant="destructive"
              >
                {mutation.isPending ? "Deleting" : "Delete duty"}
              </Button>
              <Button
                onClick={() => setView({ kind: "detail", dutyId: head.dutyId })}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section data-testid="employee-duty-detail">
        <Button
          className="mb-4 px-0"
          onClick={() => setView({ kind: "list" })}
          type="button"
          variant="link"
        >
          <ArrowLeft aria-hidden="true" /> Routines
        </Button>
        <h2 className="text-xl font-semibold tracking-tight">
          {head.proposal.title}
        </h2>
        <div className="my-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <Badge className={statusBadgeClass(head.status)} variant="outline">
            {displayStatus(head.status)}
          </Badge>
          <span>{head.proposal.scheduleText}</span>
          <span>#{channelName ?? head.proposal.channelId}</span>
        </div>
        {error ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {workflowPageQuery.isError ? (
          <Alert className="mb-5" variant="destructive">
            <AlertTitle>Run history could not be loaded</AlertTitle>
            <AlertDescription>
              {workflowPageQuery.error.message}
            </AlertDescription>
          </Alert>
        ) : null}
        {workflowPage && !consistent ? (
          <Alert className="mb-5" variant="destructive">
            <AlertTitle>Duty schedule is out of sync</AlertTitle>
            <AlertDescription>
              The stored duty and workflow definition do not match. Refresh and
              review the duty before relying on its next run.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="mb-6 rounded-lg border border-border p-4">
          <p className="mb-2 text-sm">
            Next run:{" "}
            {head.status === "paused"
              ? "Paused"
              : workflowPageQuery.isPending
                ? "Loading"
                : consistent
                  ? (formatDutyTime(
                      workflowPage?.nextScheduledAt ?? null,
                      head.proposal.timeZone,
                    ) ?? "No upcoming run returned")
                  : "Unavailable"}
          </p>
          <p className="mb-3 text-sm">
            Last run:{" "}
            {workflowPageQuery.isPending
              ? "Loading"
              : (lastRunTime ?? "Not run yet")}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6">
            {head.proposal.instructions}
          </p>
        </div>
        <h3 className="mb-3 text-base font-semibold">Run history</h3>
        {workflowPageQuery.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading run history
          </p>
        ) : workflowPage?.runs.length ? (
          <ul aria-label="Run history" className="mb-6 divide-y divide-border">
            {workflowPage.runs.map((run) => {
              const runTime = formatRunTime(run.startedAt ?? run.createdAt);
              return (
                <li className="py-3" key={run.id}>
                  <p className="text-sm font-medium">
                    {displayStatus(run.status)}
                  </p>
                  {runTime ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {runTime}
                    </p>
                  ) : null}
                  {run.scheduleContext &&
                  run.scheduleContext.missedOccurrences > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Caught up {run.scheduleContext.missedOccurrences} missed
                      occurrences. Skipped{" "}
                      {run.scheduleContext.skippedOccurrences}.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : workflowPageQuery.isError ? null : (
          <p className="mb-6 text-sm text-muted-foreground">Not run yet.</p>
        )}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button
              onClick={() => setView({ kind: "edit", dutyId: head.dutyId })}
              type="button"
              variant="outline"
            >
              Edit duty
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() =>
                void submitDutyLifecycle(
                  head.status === "paused" ? "resume" : "pause",
                )
              }
              type="button"
              variant="outline"
            >
              {head.status === "paused" ? "Resume" : "Pause"}
            </Button>
            <Button
              onClick={() => setView({ kind: "delete", dutyId: head.dutyId })}
              type="button"
              variant="destructive"
            >
              Delete duty
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section data-testid="employee-duties">
      <div className="mb-3 mt-6 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Routines</h2>
      </div>
      {dutiesQuery.data?.length ? (
        <div className="divide-y divide-border">
          {dutiesQuery.data.map(({ head }) => {
            const channelName = channelsQuery.data?.find(
              (channel) => channel.id === head.proposal.channelId,
            )?.name;
            return (
              <button
                className="flex w-full items-center gap-4 py-4 text-left hover:bg-muted/40"
                data-testid={`employee-duty-${head.dutyId}`}
                key={head.dutyId}
                onClick={() => setView({ kind: "detail", dutyId: head.dutyId })}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {head.proposal.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {head.proposal.scheduleText} · #
                    {channelName ?? head.proposal.channelId}
                  </span>
                </span>
                <Badge
                  className={statusBadgeClass(head.status)}
                  variant="outline"
                >
                  {displayStatus(head.status)}
                </Badge>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border p-5">
          <h3 className="text-base font-semibold">No duties yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Set a routine when the work needs to repeat.
          </p>
        </div>
      )}
    </section>
  );
}
