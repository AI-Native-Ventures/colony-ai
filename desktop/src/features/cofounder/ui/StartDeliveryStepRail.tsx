import type { ManagedAgent } from "@/shared/api/types";
import { agentAntBackgroundForRole } from "@/features/agents/ui/agentAntAvatar";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { getInitials } from "@/shared/lib/initials";

import type { PlaybookStepView } from "../playbookRecords";

type StepOwnerKind = "agent" | "function" | "owner" | "worker";

function WorkerCog() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.1"
      viewBox="0 0 24 24"
      width="20"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function stepOwnerKind(step: PlaybookStepView): StepOwnerKind {
  if (step.owner.kind === "owner") return "owner";
  if (step.owner.kind === "worker") return "worker";
  if (step.owner.kind === "function") return "function";
  return "agent";
}

function DoerCircle({
  agents,
  kind,
  ownerInitials,
  ownerLabel,
  profiles,
  step,
}: {
  agents: readonly ManagedAgent[];
  kind: StepOwnerKind;
  ownerInitials: string;
  ownerLabel: string;
  profiles: Readonly<Record<string, { avatarUrl?: string | null }>>;
  step: PlaybookStepView;
}) {
  if (kind === "agent") {
    const agent = agents.find(
      (candidate) =>
        candidate.pubkey.toLowerCase() ===
        step.owner.agentPubkey?.toLowerCase(),
    );
    const pubkey = step.owner.agentPubkey?.toLowerCase() ?? "";
    const profileAvatar = profiles[pubkey]?.avatarUrl?.trim();
    const photoAvatar = profileAvatar || agent?.avatarUrl?.trim();
    return (
      <EmployeeAvatar
        className={`start-delivery-avatar${photoAvatar ? " is-photo" : " is-ant"}`}
        name={ownerLabel}
        profile={profileAvatar}
        personaId={agent?.personaId}
        pubkey={step.owner.agentPubkey}
      />
    );
  }

  if (kind === "owner") return ownerInitials;
  if (kind === "worker") return <WorkerCog />;
  return getInitials(ownerLabel);
}

export function StartDeliveryStepRail({
  agents,
  getOwnerLabel,
  ownerInitials,
  profiles,
  steps,
}: {
  agents: readonly ManagedAgent[];
  getOwnerLabel: (step: PlaybookStepView) => string;
  ownerInitials: string;
  profiles: Readonly<Record<string, { avatarUrl?: string | null }>>;
  steps: readonly PlaybookStepView[];
}) {
  const rows = Array.from({ length: Math.ceil(steps.length / 7) }, (_, index) =>
    steps.slice(index * 7, (index + 1) * 7),
  );

  return (
    <section
      aria-label="Delivery steps"
      className="start-delivery-rail-panel"
      data-testid="start-delivery-rail-panel"
    >
      {rows.map((row, rowIndex) => {
        const firstNumber = rowIndex * 7 + 1;
        const lastNumber = firstNumber + row.length - 1;
        return (
          <ol
            aria-label={`Delivery steps ${firstNumber} through ${lastNumber}`}
            className="start-delivery-rail-row"
            key={firstNumber}
          >
            {row.map((step, localIndex) => {
              const number = firstNumber + localIndex;
              const kind = stepOwnerKind(step);
              const ownerLabel = getOwnerLabel(step);
              const isOwnerStep = kind === "owner";
              const needsOwnerOk = step.approvalPoint !== null && !isOwnerStep;
              const accessibleLabel = `Step ${number}: ${step.title}, ${ownerLabel}${needsOwnerOk ? ", needs your OK" : ""}`;
              const agent =
                kind === "agent"
                  ? agents.find(
                      (candidate) =>
                        candidate.pubkey.toLowerCase() ===
                        step.owner.agentPubkey?.toLowerCase(),
                    )
                  : null;
              const agentProfileAvatar =
                profiles[
                  step.owner.agentPubkey?.toLowerCase() ?? ""
                ]?.avatarUrl?.trim();
              const hasAgentPhoto =
                Boolean(agentProfileAvatar) ||
                Boolean(agent?.avatarUrl?.trim());
              const isScoutAgent =
                agent?.personaId === "builtin:fizz" ||
                agent?.name.trim().toLowerCase() === "scout" ||
                ownerLabel.trim().toLowerCase() === "scout";
              const agentBackground =
                kind === "agent" && !hasAgentPhoto
                  ? agentAntBackgroundForRole(
                      isScoutAgent ? "Other" : undefined,
                      isScoutAgent ? "green" : undefined,
                    )
                  : undefined;

              return (
                <li
                  aria-label={accessibleLabel}
                  className="start-delivery-rail-step"
                  data-testid={`start-delivery-step-${step.stepId}`}
                  key={step.stepId}
                  title={accessibleLabel}
                >
                  <span
                    aria-hidden="true"
                    className={`start-delivery-doer start-delivery-doer-${kind}`}
                    data-doer-kind={kind}
                    data-testid={`start-delivery-doer-${step.stepId}`}
                    style={
                      agentBackground
                        ? { backgroundColor: agentBackground }
                        : undefined
                    }
                  >
                    <DoerCircle
                      agents={agents}
                      kind={kind}
                      ownerInitials={ownerInitials}
                      ownerLabel={ownerLabel}
                      profiles={profiles}
                      step={step}
                    />
                  </span>
                  <span
                    className={`start-delivery-step-number${isOwnerStep ? " is-owner" : ""}`}
                    data-testid={`start-delivery-step-number-${step.stepId}`}
                  >
                    {number}
                  </span>
                  {needsOwnerOk ? (
                    <span
                      aria-hidden="true"
                      className="start-delivery-approval-dot"
                      data-testid="start-delivery-approval-dot"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        );
      })}
    </section>
  );
}
