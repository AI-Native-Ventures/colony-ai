import { ArrowDown, ArrowUp, Eye, Pause, Plus, Trash2 } from "lucide-react";
import type * as React from "react";

import type {
  Channel,
  ChannelMember,
  Workflow,
  WorkflowPreview,
  WorkflowRun,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/cn";
import {
  DetailStep,
  Field,
  getCandidates,
  memberLabel,
  newStepId,
  ProfileChip,
  RunHistory,
  selectedPubkey,
  withSelectedPubkey,
} from "./PlainWorkflowBuilderParts";
import type {
  PlainAgentStep,
  PlainApprovalStep,
  PlainWorkflowDraft,
} from "./plainWorkflowModel";
import { plainScheduleDescription } from "./plainWorkflowModel";
import type {
  BuilderScreen,
  EditableStep,
  StepEditor,
} from "./plainWorkflowBuilderTypes";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type PlainWorkflowBuilderScreensProps = {
  screen: BuilderScreen;
  draft: PlainWorkflowDraft;
  setDraft: React.Dispatch<React.SetStateAction<PlainWorkflowDraft>>;
  startFromExample: boolean;
  setStartFromExample: React.Dispatch<React.SetStateAction<boolean>>;
  channels: Channel[];
  memberQueryPending: boolean;
  saving: boolean;
  error: string | null;
  hasUnpublishedChanges: boolean;
  back: () => void;
  setScreen: React.Dispatch<React.SetStateAction<BuilderScreen>>;
  stepEditor: StepEditor;
  setStepEditor: React.Dispatch<React.SetStateAction<StepEditor>>;
  changeStepOrder: (index: number, offset: -1 | 1) => Promise<void>;
  removeIndex: number | null;
  setRemoveIndex: React.Dispatch<React.SetStateAction<number | null>>;
  removeStep: (index: number) => Promise<void>;
  setStep: (updated: EditableStep) => void;
  handleContinueDescription: () => void;
  handleSaveTiming: () => Promise<void>;
  handleSaveStep: () => Promise<void>;
  handlePreview: () => Promise<void>;
  handlePublish: () => Promise<void>;
  handleStatusChange: () => Promise<void>;
  previewLoading: boolean;
  preview: WorkflowPreview | null;
  confirmReviewed: boolean;
  setConfirmReviewed: React.Dispatch<React.SetStateAction<boolean>>;
  publishing: boolean;
  changingStatus: boolean;
  members: ChannelMember[];
  profiles: Record<string, { displayName: string | null }> | undefined;
  openProfilePanel: (pubkey: string) => void;
  currentChannel: Channel | undefined;
  workflow: Workflow | undefined;
  isWorkflowOwner: boolean;
  goEditWorkflow: (workflowId: string) => void;
  runs: WorkflowRun[] | undefined;
};

export function PlainWorkflowBuilderScreens({
  screen,
  draft,
  setDraft,
  startFromExample,
  setStartFromExample,
  channels,
  memberQueryPending,
  saving,
  error,
  hasUnpublishedChanges,
  back,
  setScreen,
  stepEditor,
  setStepEditor,
  changeStepOrder,
  removeIndex,
  setRemoveIndex,
  removeStep,
  setStep,
  handleContinueDescription,
  handleSaveTiming,
  handleSaveStep,
  handlePreview,
  handlePublish,
  handleStatusChange,
  previewLoading,
  preview,
  confirmReviewed,
  setConfirmReviewed,
  publishing,
  changingStatus,
  members,
  profiles,
  openProfilePanel,
  currentChannel,
  workflow,
  isWorkflowOwner,
  goEditWorkflow,
  runs,
}: PlainWorkflowBuilderScreensProps) {
  return (
    <>
      {screen === "describe" ? (
        <section className="max-w-3xl space-y-5">
          <Field label="Give this workflow a name">
            <Input
              autoFocus
              autoCapitalize="off"
              data-testid="plain-workflow-name"
              maxLength={100}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              value={draft.name}
            />
          </Field>
          <Field label="Describe the routine">
            <Textarea
              className="min-h-28"
              data-testid="plain-workflow-description"
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              placeholder="Include when it happens, who is involved and what a good result looks like."
              value={draft.description}
            />
          </Field>
          <p className="text-sm leading-6 text-muted-foreground">
            You can build the steps yourself or adapt the content-plan example.
          </p>
          <Field label="Start with">
            <select
              aria-label="Start with"
              className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              onChange={(event) =>
                setStartFromExample(event.target.value === "example")
              }
              value={startFromExample ? "example" : "blank"}
            >
              <option value="example">Weekly content-plan example</option>
              <option value="blank">My own steps</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              disabled={saving || memberQueryPending}
              onClick={handleContinueDescription}
            >
              Continue
            </Button>
            <Button onClick={back} variant="outline">
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "timing" ? (
        <section className="max-w-3xl space-y-6">
          <Field label="Start">
            <select
              aria-label="Start"
              className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  schedule: {
                    ...draft.schedule,
                    frequency: event.target
                      .value as PlainWorkflowDraft["schedule"]["frequency"],
                  },
                })
              }
              value={draft.schedule.frequency}
            >
              <option value="weekly">Every week</option>
              <option value="daily">Every day</option>
              <option value="manual">When I start it</option>
            </select>
          </Field>
          {draft.schedule.frequency === "weekly" ? (
            <Field label="Day">
              <select
                aria-label="Day for weekly routines"
                className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    schedule: {
                      ...draft.schedule,
                      day: Number(event.target.value),
                    },
                  })
                }
                value={draft.schedule.day}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {draft.schedule.frequency !== "manual" ? (
            <Field label="Time">
              <Input
                aria-label="Time"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    schedule: { ...draft.schedule, time: event.target.value },
                  })
                }
                type="time"
                value={draft.schedule.time}
              />
            </Field>
          ) : null}
          <p className="text-sm leading-6 text-muted-foreground">
            Johannesburg time (SAST). Manual workflows start only when you
            choose to run them.
          </p>
          <Field label="Where should updates appear?">
            <select
              aria-label="Where should updates appear?"
              className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              onChange={(event) =>
                setDraft({ ...draft, channelId: event.target.value })
              }
              value={draft.channelId}
            >
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </Field>
          {channels.length === 0 ? (
            <p className="text-sm text-destructive" role="alert">
              Join a channel before creating a workflow.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              disabled={!draft.channelId || saving || memberQueryPending}
              onClick={() => void handleSaveTiming()}
            >
              {saving ? "Saving…" : "Save timing"}
            </Button>
            <Button onClick={back} variant="outline">
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "steps" ? (
        <section className="space-y-6">
          {hasUnpublishedChanges ? (
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
              role="status"
            >
              You have unpublished changes. The active version stays in place
              until you review and publish this draft.
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{draft.name}</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {draft.description}
              </p>
              <div className="mt-4 rounded-lg border border-border/70 px-4 py-3">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  When it starts
                </span>
                <span className="mt-1 block text-sm font-medium">
                  {plainScheduleDescription(draft.schedule)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setScreen("describe")} variant="outline">
                Edit name & description
              </Button>
              <Button onClick={() => setScreen("timing")} variant="outline">
                Change timing & updates
              </Button>
            </div>
          </div>
          {draft.steps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
              <h2 className="text-base font-semibold">
                Build your workflow steps
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Add an agent preparation step or ask a person to approve a
                result.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border rounded-xl border border-border/70 bg-card px-4 sm:px-6">
              {draft.steps.map((step, index) => (
                <li className="flex gap-4 py-5" key={step.id}>
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {step.kind === "agent"
                            ? "Prepare something"
                            : "Ask for approval"}
                        </span>
                        <h2 className="mt-1 text-base font-semibold">
                          {step.title ||
                            (step.kind === "agent"
                              ? "Prepare a result"
                              : "Review this step")}
                        </h2>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          aria-label={`Edit step ${index + 1}`}
                          onClick={() => {
                            setStepEditor({
                              step: structuredClone(step) as EditableStep,
                              index,
                            });
                            setScreen("step");
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          Edit
                        </Button>
                        <Button
                          aria-label={`Move step ${index + 1} up`}
                          disabled={index === 0 || saving}
                          onClick={() => void changeStepOrder(index, -1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={`Move step ${index + 1} down`}
                          disabled={index === draft.steps.length - 1 || saving}
                          onClick={() => void changeStepOrder(index, 1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={`Remove step ${index + 1}`}
                          disabled={saving}
                          onClick={() => {
                            setRemoveIndex(index);
                            setScreen("remove");
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    <span className="block text-sm text-muted-foreground">
                      {step.kind === "agent"
                        ? "Runs this step"
                        : "Reviews this step"}
                    </span>
                    <ProfileChip
                      member={members.find(
                        (member) =>
                          member.pubkey.toLowerCase() ===
                          (step.kind === "agent"
                            ? step.assigneePubkey
                            : step.reviewerPubkey
                          ).toLowerCase(),
                      )}
                      onOpen={(pubkey) => openProfilePanel?.(pubkey)}
                      profiles={profiles}
                    />
                    <p className="text-sm leading-6 text-muted-foreground">
                      {step.kind === "agent" ? step.instruction : step.message}
                    </p>
                    {step.kind === "agent" && step.expectedResult ? (
                      <p className="text-sm text-muted-foreground">
                        Ready when: {step.expectedResult}
                      </p>
                    ) : null}
                    {step.kind === "approval" ? (
                      <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                        The run waits here for approval.
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={memberQueryPending || saving}
              onClick={() => {
                const kind = members.some((member) => member.isAgent)
                  ? "agent"
                  : "approval";
                const candidate = getCandidates(members, kind)[0];
                const step: EditableStep =
                  kind === "agent"
                    ? {
                        id: newStepId(),
                        kind,
                        title: "",
                        assigneePubkey: candidate?.pubkey ?? "",
                        instruction: "",
                        expectedResult: "",
                      }
                    : {
                        id: newStepId(),
                        kind,
                        title: "",
                        reviewerPubkey: candidate?.pubkey ?? "",
                        message: "",
                      };
                setStepEditor({ step, index: null });
                setScreen("step");
              }}
            >
              <Plus aria-hidden="true" />
              Add a step
            </Button>
            {draft.steps.length > 0 ? (
              <Button
                disabled={saving || previewLoading}
                onClick={() => void handlePreview()}
                variant="outline"
              >
                <Eye aria-hidden="true" />
                Preview a sample run
              </Button>
            ) : null}
          </div>
          {draft.steps.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
              <p className="text-sm text-muted-foreground">
                Updates go to{" "}
                <strong className="font-medium text-foreground">
                  #{currentChannel?.name ?? "channel unavailable"}
                </strong>
                . A failed step stops the run.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {screen === "remove" && removeIndex !== null ? (
        <section className="max-w-3xl space-y-5">
          <div className="rounded-xl border border-border p-5">
            <h2 className="text-base font-semibold">
              {draft.steps[removeIndex]?.title || "Step"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Only the draft changes. You can add a step again before
              activating.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              disabled={saving}
              onClick={() => void removeStep(removeIndex)}
              variant="destructive"
            >
              {saving ? "Removing…" : "Remove step"}
            </Button>
            <Button disabled={saving} onClick={back} variant="outline">
              Keep step
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "step" && stepEditor ? (
        <section className="max-w-3xl space-y-5">
          <Field label="What kind of step?">
            <select
              aria-label="What kind of step?"
              className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              onChange={(event) => {
                const kind = event.target.value as EditableStep["kind"];
                const candidate = getCandidates(members, kind)[0];
                setStep(
                  kind === "agent"
                    ? {
                        id: stepEditor.step.id,
                        kind,
                        title: stepEditor.step.title,
                        assigneePubkey: candidate?.pubkey ?? "",
                        instruction: "",
                        expectedResult: "",
                      }
                    : {
                        id: stepEditor.step.id,
                        kind,
                        title: stepEditor.step.title,
                        reviewerPubkey: candidate?.pubkey ?? "",
                        message: "",
                      },
                );
              }}
              value={stepEditor.step.kind}
            >
              <option value="agent">Prepare something</option>
              <option value="approval">Ask for approval</option>
            </select>
          </Field>
          <Field label="Step name">
            <Input
              autoCapitalize="off"
              onChange={(event) =>
                setStep({ ...stepEditor.step, title: event.target.value })
              }
              value={stepEditor.step.title}
            />
          </Field>
          <Field label="Who is responsible?">
            <select
              aria-label="Who is responsible?"
              className="flex h-10 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              onChange={(event) =>
                setStep(withSelectedPubkey(stepEditor.step, event.target.value))
              }
              value={selectedPubkey(stepEditor.step)}
            >
              <option value="">Choose a person</option>
              {getCandidates(members, stepEditor.step.kind).map((member) => (
                <option key={member.pubkey} value={member.pubkey}>
                  {memberLabel(member, profiles)}
                </option>
              ))}
            </select>
          </Field>
          <ProfileChip
            member={members.find(
              (member) =>
                member.pubkey.toLowerCase() ===
                selectedPubkey(stepEditor.step).toLowerCase(),
            )}
            onOpen={(pubkey) => openProfilePanel?.(pubkey)}
            profiles={profiles}
          />
          {stepEditor.step.kind === "agent" ? (
            <>
              <Field label="What should they do?">
                <Textarea
                  className="min-h-24"
                  onChange={(event) =>
                    setStep({
                      ...(stepEditor.step as PlainAgentStep),
                      instruction: event.target.value,
                    })
                  }
                  value={stepEditor.step.instruction}
                />
              </Field>
              <Field label="What should be ready when they finish?">
                <Textarea
                  className="min-h-20"
                  onChange={(event) =>
                    setStep({
                      ...(stepEditor.step as PlainAgentStep),
                      expectedResult: event.target.value,
                    })
                  }
                  value={stepEditor.step.expectedResult}
                />
              </Field>
            </>
          ) : (
            <Field label="What should the reviewer approve?">
              <Textarea
                className="min-h-24"
                onChange={(event) =>
                  setStep({
                    ...(stepEditor.step as PlainApprovalStep),
                    message: event.target.value,
                  })
                }
                value={stepEditor.step.message}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              disabled={saving || memberQueryPending}
              onClick={() => void handleSaveStep()}
            >
              {saving ? "Saving…" : "Save step"}
            </Button>
            <Button onClick={back} variant="outline">
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "preview" ? (
        <section className="space-y-5" data-testid="workflow-preview">
          <div
            className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm"
            role="status"
          >
            Preview only. No messages, approvals, agent requests or webhooks are
            sent.
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {plainScheduleDescription(draft.schedule)}. Review what each step
            would do before activation.
          </p>
          {previewLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Preparing preview…
            </p>
          ) : null}
          {preview?.steps.map((step, index) => (
            <article
              className="rounded-xl border border-border/70 bg-card p-5"
              key={step.stepId}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">
                    {draft.steps[index]?.title || `Step ${index + 1}`}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step.action}
                  </p>
                  <ul className="mt-4 space-y-2 border-l border-border pl-4 text-sm">
                    {step.paths.map((path) => (
                      <li className="text-muted-foreground" key={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                  {step.note ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {step.note}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              onClick={() => {
                setConfirmReviewed(false);
                setScreen("review");
              }}
            >
              Review activation
            </Button>
            <Button onClick={() => setScreen("steps")} variant="outline">
              Edit steps
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "review" ? (
        <section
          className="max-w-4xl space-y-5"
          data-testid="workflow-activation-review"
        >
          <div className="rounded-xl border border-border/70 bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{draft.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {draft.description}
            </p>
            <p className="mt-3 text-sm font-medium">
              {plainScheduleDescription(draft.schedule)} · #
              {currentChannel?.name ?? "channel unavailable"}
            </p>
            <ol className="mt-4 divide-y divide-border">
              {draft.steps.map((step, index) => (
                <DetailStep
                  index={index}
                  key={step.id}
                  members={members}
                  onOpenProfile={(pubkey) => openProfilePanel?.(pubkey)}
                  profiles={profiles}
                  step={step}
                />
              ))}
            </ol>
          </div>
          {draft.steps.some((step) => step.kind === "approval") ? (
            <div className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-sm">
              Approval always comes first. The run waits for the named reviewer.
            </div>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-4 text-sm">
            <input
              checked={confirmReviewed}
              className="mt-0.5 size-4 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setConfirmReviewed(event.target.checked)}
              type="checkbox"
            />
            <span>I have reviewed the steps, people and schedule.</span>
          </label>
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            <Button
              disabled={publishing || !confirmReviewed}
              onClick={() => void handlePublish()}
            >
              {publishing
                ? "Publishing…"
                : workflow
                  ? "Save and turn on"
                  : "Turn on workflow"}
            </Button>
            <Button onClick={() => setScreen("steps")} variant="outline">
              Edit steps
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "detail" && workflow ? (
        <section className="space-y-7" data-testid="plain-workflow-detail">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                workflow.status === "active"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {workflow.status === "active" ? "Active" : "Paused"}
            </span>
            <span className="text-sm text-muted-foreground">
              {plainScheduleDescription(draft.schedule)}
            </span>
          </div>
          <div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {draft.description}
            </p>
            <p className="mt-3 text-sm">
              Updates go to{" "}
              <strong>#{currentChannel?.name ?? "channel unavailable"}</strong>
            </p>
          </div>
          {hasUnpublishedChanges ? (
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
              role="status"
            >
              An unpublished draft exists. The active version is still running
              until you review and publish the changes.
            </div>
          ) : null}
          <ol className="divide-y divide-border rounded-xl border border-border/70 bg-card px-4 sm:px-6">
            {draft.steps.map((step, index) => (
              <DetailStep
                index={index}
                key={step.id}
                members={members}
                onOpenProfile={(pubkey) => openProfilePanel?.(pubkey)}
                profiles={profiles}
                step={step}
              />
            ))}
          </ol>
          <RunHistory runs={runs} />
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
            {isWorkflowOwner ? (
              <Button
                onClick={() => void goEditWorkflow(workflow.id)}
                variant="outline"
              >
                Edit workflow
              </Button>
            ) : null}
            {isWorkflowOwner && workflow.status === "active" ? (
              <Button onClick={() => setScreen("pause")} variant="outline">
                <Pause aria-hidden="true" />
                Pause
              </Button>
            ) : null}
            {isWorkflowOwner && workflow.status !== "active" ? (
              <Button
                onClick={() => {
                  setConfirmReviewed(false);
                  setScreen("review");
                }}
              >
                Review & turn on
              </Button>
            ) : null}
            {!isWorkflowOwner ? (
              <p className="self-center text-sm text-muted-foreground">
                Only the workflow owner can save or publish a draft.
              </p>
            ) : null}
            <Button onClick={() => void handlePreview()} variant="ghost">
              <Eye aria-hidden="true" />
              Preview a sample run
            </Button>
          </div>
        </section>
      ) : null}

      {screen === "pause" ? (
        <section className="max-w-2xl space-y-5">
          <div className="rounded-xl border border-border p-5">
            <h2 className="text-base font-semibold">{workflow?.name}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              No new runs will start. Any run already in progress would remain
              visible for a separate decision.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={changingStatus}
              onClick={() => void handleStatusChange()}
            >
              {changingStatus ? "Pausing…" : "Pause workflow"}
            </Button>
            <Button onClick={() => setScreen("detail")} variant="outline">
              Keep running
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
