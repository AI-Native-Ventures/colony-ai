import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { FUNCTION_DETAILS } from "../functions";
import type { FunctionId } from "../cofounderRecords";
import { playbookJobActions } from "../playbookActions";
import { usePlaybookJobAction } from "../playbookHooks";
import type { PlaybookStepView, PlaybookView } from "../playbookRecords";
import { startDeliveryOwnerStepNumbers } from "../startDelivery";

type ProfileLookup = Record<string, { displayName: string | null }>;

function titleCaseIdentifier(value: string): string {
  return value
    .replaceAll(/[_-]+/gu, " ")
    .replaceAll(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function personLabel(
  pubkey: string | null,
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): string {
  if (!pubkey) return "Company agent";
  if (selfPubkey?.toLowerCase() === pubkey.toLowerCase()) return "You";
  const profileName = profiles[pubkey.toLowerCase()]?.displayName?.trim();
  const agentName = agents.find(
    (agent) => agent.pubkey.toLowerCase() === pubkey.toLowerCase(),
  )?.name;
  return profileName || agentName?.trim() || "Company agent";
}

function stepOwnerLabel(
  step: PlaybookStepView,
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): string {
  const owner = step.owner;
  if (owner.kind === "owner") return "You";
  if (owner.kind === "worker") {
    return owner.workerType
      ? `${titleCaseIdentifier(owner.workerType)} worker`
      : "Worker";
  }
  if (owner.kind === "function") {
    return owner.functionId
      ? FUNCTION_DETAILS[owner.functionId as FunctionId].name
      : "Company function";
  }
  return personLabel(owner.agentPubkey, profiles, agents, selfPubkey);
}

function stepNumberList(numbers: readonly number[]): string {
  if (numbers.length < 2) return String(numbers[0] ?? "");
  const last = numbers[numbers.length - 1];
  return `${numbers.slice(0, -1).join(", ")}, and ${last}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The delivery could not be started. Try again.";
}

export function StartDeliveryDialog({
  clientName,
  onOpenChange,
  open,
  playbooks,
}: {
  clientName: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  playbooks: readonly PlaybookView[];
}) {
  const navigate = useNavigate();
  const jobAction = usePlaybookJobAction();
  const membership = useMyRelayMembershipQuery();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(
    playbooks[0]?.playbookId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPlaybook =
    playbooks.find((item) => item.playbookId === selectedPlaybookId) ??
    playbooks[0] ??
    null;
  const profilePubkeys = useMemo(
    () =>
      [
        ...new Set(
          (selectedPlaybook?.current?.steps ?? [])
            .map((step) => step.owner.agentPubkey)
            .filter((pubkey): pubkey is string => pubkey !== null)
            .map((pubkey) => pubkey.toLowerCase()),
        ),
      ].slice(0, 200),
    [selectedPlaybook],
  );
  const agentsQuery = useManagedAgentsQuery({ enabled: open });
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: open && profilePubkeys.length > 0,
  });
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const agents = (agentsQuery.data ?? []).map((agent) => ({
    pubkey: agent.pubkey,
    name: agent.name,
  }));

  useEffect(() => {
    if (
      !playbooks.some((item) => item.playbookId === selectedPlaybookId) &&
      playbooks[0]
    ) {
      setSelectedPlaybookId(playbooks[0].playbookId);
    }
  }, [playbooks, selectedPlaybookId]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!selectedPlaybook?.current) return null;

  const steps = selectedPlaybook.current.steps;
  const ownerSteps = startDeliveryOwnerStepNumbers(selectedPlaybook);
  const firstOwner = stepOwnerLabel(
    steps[0],
    profiles,
    agents,
    membership.data?.pubkey,
  );
  const firstStepSentence =
    firstOwner === "You" ? "You start step 1." : `${firstOwner} starts step 1.`;

  async function startDelivery() {
    if (!selectedPlaybook || saving) return;
    setSaving(true);
    setError(null);
    let started = false;
    try {
      await jobAction.mutateAsync(
        playbookJobActions.start(
          selectedPlaybook,
          crypto.randomUUID(),
          clientName,
        ),
      );
      started = true;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
    if (!started) return;
    onOpenChange(false);
    void navigate({
      to: "/company/function/$function",
      params: { function: "operations" },
    });
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && saving) return;
        if (nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
        data-testid="start-delivery-dialog"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>Start work for {clientName}?</DialogTitle>
          <DialogDescription>
            {selectedPlaybook.current.title}, {steps.length} steps
          </DialogDescription>
        </DialogHeader>
        {playbooks.length > 1 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Choose a playbook</legend>
            <div className="grid gap-2">
              {playbooks.map((playbook) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-colony-border px-3 py-2 text-sm"
                  key={playbook.playbookId}
                >
                  <input
                    checked={
                      selectedPlaybook.playbookId === playbook.playbookId
                    }
                    name="start-delivery-playbook"
                    onChange={() => {
                      setSelectedPlaybookId(playbook.playbookId);
                      setError(null);
                    }}
                    type="radio"
                    value={playbook.playbookId}
                  />
                  <span>{playbook.current?.title ?? playbook.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <ol
          aria-label="Delivery steps"
          className="flex w-full items-start justify-between gap-1 py-1"
        >
          {steps.map((step, index) => {
            const isOwnerStep = step.owner.kind === "owner";
            const owner = stepOwnerLabel(
              step,
              profiles,
              agents,
              membership.data?.pubkey,
            );
            return (
              <li
                className="flex w-9 shrink-0 flex-col items-center gap-1 text-center"
                data-testid={`start-delivery-step-${step.stepId}`}
                key={step.stepId}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    isOwnerStep
                      ? "border-colony-fg bg-colony-fg text-colony-pop"
                      : step.approvalPoint
                        ? "border-colony-accent bg-colony-accent/10 text-colony-accent"
                        : "border-colony-border bg-colony-track text-colony-fg-secondary"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col items-center gap-0.5">
                  <span
                    className="break-words text-2xs leading-tight text-colony-fg-secondary max-[30rem]:sr-only"
                    data-testid="start-delivery-owner-label"
                  >
                    {owner}
                  </span>
                  {step.approvalPoint ? (
                    <span className="rounded-full bg-colony-accent/10 px-1 text-3xs font-semibold text-colony-accent">
                      Your OK
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">{step.title}</span>
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-colony-fg-secondary">
          {firstStepSentence}
          {ownerSteps.length > 0
            ? ` You are needed at steps ${stepNumberList(ownerSteps)}.`
            : ""}
        </p>
        {error ? (
          <p
            aria-live="assertive"
            className="text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            className="w-full sm:w-auto"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Not yet
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={saving}
            onClick={() => void startDelivery()}
            type="button"
          >
            {saving ? "Starting..." : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
