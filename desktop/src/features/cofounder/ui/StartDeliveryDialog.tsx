import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { agentAntBackgroundForRole } from "@/features/agents/ui/agentAntAvatar";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { getInitials } from "@/shared/lib/initials";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

import { FUNCTION_DETAILS } from "../functions";
import type { FunctionId } from "../cofounderRecords";
import { playbookJobActions } from "../playbookActions";
import { usePlaybookJobAction } from "../playbookHooks";
import type { PlaybookStepView, PlaybookView } from "../playbookRecords";
import {
  startDeliverySentence,
  startDeliveryOwnerStepNumbers,
} from "../startDelivery";
import { StartDeliveryStepRail } from "./StartDeliveryStepRail";
import "./StartDeliveryDialog.css";

type ProfileLookup = Record<
  string,
  { avatarUrl?: string | null; displayName: string | null }
>;

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
  const profilePubkeys = useMemo(() => {
    const pubkeys = (selectedPlaybook?.current?.steps ?? [])
      .map((step) => step.owner.agentPubkey)
      .filter((pubkey): pubkey is string => pubkey !== null)
      .map((pubkey) => pubkey.toLowerCase());
    if (membership.data?.pubkey) {
      pubkeys.push(membership.data.pubkey.toLowerCase());
    }
    return [...new Set(pubkeys)].slice(0, 200);
  }, [membership.data?.pubkey, selectedPlaybook]);
  const agentsQuery = useManagedAgentsQuery({ enabled: open });
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: open && profilePubkeys.length > 0,
  });
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const agents = agentsQuery.data ?? [];

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
  const deliverySentence = startDeliverySentence(firstOwner, ownerSteps);
  const workflowName =
    selectedPlaybook.current.title.replace(/\s+playbook$/iu, "").trim() ||
    selectedPlaybook.current.title;
  const selfPubkey = membership.data?.pubkey?.toLowerCase();
  const ownerInitials = getInitials(
    profiles[selfPubkey ?? ""]?.displayName?.trim() || "You",
  );
  const scout =
    agents.find((agent) => agent.name.trim().toLowerCase() === "scout") ??
    agents.find((agent) => agent.personaId === "builtin:fizz") ??
    null;
  const scoutProfileAvatar = scout
    ? profiles[scout.pubkey.toLowerCase()]?.avatarUrl?.trim()
    : undefined;
  const scoutHasPhoto = Boolean(scoutProfileAvatar || scout?.avatarUrl?.trim());

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
        className="start-delivery-dialog"
        data-testid="start-delivery-dialog"
        showCloseButton={false}
      >
        <div className={`start-delivery-heading${scout ? " has-scout" : ""}`}>
          {scout ? (
            <span
              className="start-delivery-scout-avatar"
              data-testid="start-delivery-scout-avatar"
              style={
                scoutHasPhoto
                  ? undefined
                  : {
                      backgroundColor: agentAntBackgroundForRole(
                        "Other",
                        "green",
                      ),
                    }
              }
            >
              <EmployeeAvatar
                className={`start-delivery-scout-art${scoutHasPhoto ? " is-photo" : " is-ant"}`}
                name={scout.name}
                profile={scoutProfileAvatar}
                personaId={scout.personaId}
                pubkey={scout.pubkey}
              />
            </span>
          ) : null}
          <div className="start-delivery-heading-copy">
            <DialogDescription className="start-delivery-description">
              {clientName} is a client now.
            </DialogDescription>
            <DialogTitle className="start-delivery-title">
              Start {workflowName}?
            </DialogTitle>
          </div>
        </div>
        {playbooks.length > 1 ? (
          <fieldset className="start-delivery-playbook-choice">
            <legend>Choose a playbook</legend>
            {playbooks.map((playbook) => (
              <label
                className="start-delivery-playbook-option"
                key={playbook.playbookId}
              >
                <input
                  checked={selectedPlaybook.playbookId === playbook.playbookId}
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
          </fieldset>
        ) : null}
        <StartDeliveryStepRail
          agents={agents}
          getOwnerLabel={(step) =>
            stepOwnerLabel(step, profiles, agents, membership.data?.pubkey)
          }
          ownerInitials={ownerInitials}
          profiles={profiles}
          steps={steps}
        />
        <p className="start-delivery-sentence">{deliverySentence}</p>
        {error ? (
          <p
            aria-live="assertive"
            className="start-delivery-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="start-delivery-actions">
          <button
            className="start-delivery-action start-delivery-action-primary"
            data-testid="start-delivery-start"
            disabled={saving}
            onClick={() => void startDelivery()}
            type="button"
          >
            {saving ? "Starting..." : `Start ${workflowName}`}
          </button>
          <button
            className="start-delivery-action start-delivery-action-secondary"
            data-testid="start-delivery-not-yet"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Not yet
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
