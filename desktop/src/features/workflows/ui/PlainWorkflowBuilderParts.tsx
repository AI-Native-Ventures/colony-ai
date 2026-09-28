import { ArrowLeft, Workflow as WorkflowIcon } from "lucide-react";
import * as React from "react";

import type { ChannelMember, WorkflowRun } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import type { PlainWorkflowStep } from "./plainWorkflowModel";
import type { EditableStep } from "./plainWorkflowBuilderTypes";

export function newStepId(): string {
  return `step_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function memberLabel(
  member: ChannelMember,
  profiles: Record<string, { displayName: string | null }> | undefined,
) {
  return (
    member.displayName?.trim() ||
    profiles?.[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function memberRoleLabel(member: ChannelMember): string {
  return member.isAgent ? "AI agent" : "Human";
}

export function getCandidates(
  members: ChannelMember[],
  kind: EditableStep["kind"],
) {
  return members.filter((member) =>
    kind === "agent" ? member.isAgent : !member.isAgent,
  );
}

export function selectedPubkey(step: EditableStep): string {
  return step.kind === "agent" ? step.assigneePubkey : step.reviewerPubkey;
}

export function withSelectedPubkey(
  step: EditableStep,
  pubkey: string,
): EditableStep {
  return step.kind === "agent"
    ? { ...step, assigneePubkey: pubkey }
    : { ...step, reviewerPubkey: pubkey };
}

export function ProfileChip({
  member,
  profiles,
  onOpen,
}: {
  member: ChannelMember | undefined;
  profiles: Record<string, { displayName: string | null }> | undefined;
  onOpen: (pubkey: string) => void;
}) {
  if (!member) {
    return (
      <span className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
        Person unavailable in this channel
      </span>
    );
  }
  const label = memberLabel(member, profiles);
  return (
    <button
      aria-label={`View ${label} profile`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(member.pubkey)}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
          member.isAgent
            ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
            : "bg-primary/10 text-primary",
        )}
      >
        {label.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        {memberRoleLabel(member)}
      </span>
    </button>
  );
}

export function BuilderHeader({
  title,
  description,
  onBack,
  onClose,
  canManage,
  onAdvanced,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  onClose: () => void;
  canManage: boolean;
  onAdvanced: () => void;
}) {
  return (
    <header className="border-b border-border/70 px-5 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              aria-label="Back to workflows"
              className="-ml-2 h-8 px-2"
              onClick={onBack ?? onClose}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <span aria-hidden="true">/</span>
            <span>Workflows</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Button
            className="shrink-0"
            onClick={onAdvanced}
            size="sm"
            variant="outline"
          >
            <WorkflowIcon aria-hidden="true" />
            Advanced editor
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const generatedId = React.useId();
  const id = children.props.id ?? generatedId;
  return (
    <div className="block space-y-2 text-sm font-medium text-foreground">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}

export function DetailStep({
  index,
  step,
  members,
  profiles,
  onOpenProfile,
}: {
  index: number;
  step: PlainWorkflowStep;
  members: ChannelMember[];
  profiles: Record<string, { displayName: string | null }> | undefined;
  onOpenProfile: (pubkey: string) => void;
}) {
  const member = members.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() ===
      (step.kind === "agent"
        ? step.assigneePubkey
        : step.reviewerPubkey
      ).toLowerCase(),
  );
  return (
    <li className="flex gap-4 border-b border-border/70 py-5 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {step.kind === "agent" ? "Prepare something" : "Ask for approval"}
          </span>
        </div>
        <h2 className="text-base font-semibold text-foreground">
          {step.title ||
            (step.kind === "agent" ? "Prepare a result" : "Review this step")}
        </h2>
        <ProfileChip
          member={member}
          onOpen={onOpenProfile}
          profiles={profiles}
        />
        <p className="text-sm leading-6 text-muted-foreground">
          {step.kind === "agent" ? step.instruction : step.message}
        </p>
        {step.kind === "agent" && step.expectedResult ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Ready when: {step.expectedResult}
          </p>
        ) : null}
        {step.kind === "approval" ? (
          <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            The run waits for this person’s approval.
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function RunHistory({ runs }: { runs: WorkflowRun[] | undefined }) {
  if (!runs?.length) {
    return (
      <div className="rounded-xl border border-border/70 px-5 py-6">
        <h2 className="text-base font-semibold">Run history</h2>
        <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="workflow-run-history-title">
      <h2
        className="mb-3 text-base font-semibold"
        id="workflow-run-history-title"
      >
        Run history
      </h2>
      <ul className="divide-y divide-border rounded-xl border border-border/70">
        {runs.map((run) => (
          <li
            className="flex items-center justify-between gap-4 px-4 py-3"
            key={run.id}
          >
            <span className="text-sm text-foreground">
              {run.status.replaceAll("_", " ")}
            </span>
            <time
              className="text-xs text-muted-foreground"
              dateTime={
                run.createdAt
                  ? new Date(run.createdAt * 1000).toISOString()
                  : undefined
              }
            >
              {run.createdAt
                ? new Intl.DateTimeFormat("en-ZA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(run.createdAt * 1000))
                : ""}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
