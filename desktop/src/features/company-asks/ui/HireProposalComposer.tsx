import * as React from "react";

import { companyHireRolePackFromPersona } from "@/features/company-hiring/companyHireModels";
import type { AgentPersona } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import type {
  AskComposerDraft,
  AskComposerErrors,
  AskComposerHireContext,
} from "../askComposer";
import type { HireProposal } from "../askRecords";

export type AskHireRoleOption = {
  persona: AgentPersona;
  rolePack: HireProposal["rolePack"];
  runtimeId: string;
};

export function useAskHireProposal(
  personas: readonly AgentPersona[],
  rolePackId: string,
) {
  const roleOptions = React.useMemo(
    () =>
      personas.flatMap((persona) => {
        const rolePack = companyHireRolePackFromPersona(persona);
        if (!rolePack) return [];
        const runtimeId = rolePack.workerMenu.includes(persona.runtime ?? "")
          ? (persona.runtime ?? "")
          : (rolePack.workerMenu[0] ?? "");
        return runtimeId ? [{ persona, rolePack, runtimeId }] : [];
      }),
    [personas],
  );
  const selectedRole = roleOptions.find(
    (option) => option.persona.id === rolePackId,
  );
  const hireContext: AskComposerHireContext | undefined = selectedRole
    ? {
        rolePack: selectedRole.rolePack,
        runtimeId: selectedRole.runtimeId,
        ...(selectedRole.persona.runtime === selectedRole.runtimeId &&
        selectedRole.persona.provider
          ? { providerId: selectedRole.persona.provider }
          : {}),
        ...(selectedRole.persona.runtime === selectedRole.runtimeId &&
        selectedRole.persona.model
          ? { modelId: selectedRole.persona.model }
          : {}),
      }
    : undefined;

  return { roleOptions, selectedRole, hireContext };
}

type AskHireRecipientOption = { pubkey: string; label: string };
type UpdateAskDraft = <K extends keyof AskComposerDraft>(
  key: K,
  value: AskComposerDraft[K],
) => void;

type HireProposalComposerProps = {
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  hireProposalReview: boolean;
  selectedHireRole: AskHireRoleOption | undefined;
  roleOptions: AskHireRoleOption[];
  roleOptionsPending: boolean;
  roleOptionsError: boolean;
  roleOptionsReady: boolean;
  recipientOptions: AskHireRecipientOption[];
  recipientLoading: boolean;
  recipientError: boolean;
  channelPeople: number;
  proposalDestination: string;
  locked: boolean;
  onUpdateDraft: UpdateAskDraft;
  onRetryRoleOptions: () => void;
  onOpenRoleCatalog: () => void;
};

export function HireProposalComposer({
  draft,
  errors,
  hireProposalReview,
  selectedHireRole,
  roleOptions,
  roleOptionsPending,
  roleOptionsError,
  roleOptionsReady,
  recipientOptions,
  recipientLoading,
  recipientError,
  channelPeople,
  proposalDestination,
  locked,
  onUpdateDraft,
  onRetryRoleOptions,
  onOpenRoleCatalog,
}: HireProposalComposerProps) {
  return hireProposalReview && selectedHireRole ? (
    <div className="colony-ask-hire-review">
      <h2>Review hire proposal</h2>
      <dl>
        <div>
          <dt>Role pack</dt>
          <dd>{selectedHireRole.rolePack.title}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{draft.hireName.trim()}</dd>
        </div>
        <div>
          <dt>Title</dt>
          <dd>{draft.hireTitle.trim()}</dd>
        </div>
        <div>
          <dt>Allowance request</dt>
          <dd>USD {draft.hireAllowance.trim()} / week</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{draft.hireReason.trim()}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{proposalDestination}</dd>
        </div>
      </dl>
      <p>Submitting proposes a hire. Only the founder can complete sign-off.</p>
    </div>
  ) : (
    <>
      <label htmlFor="ask-addressee">Recipient</label>
      <select
        aria-describedby={
          errors.addresseePubkey ? "ask-addressee-error" : undefined
        }
        aria-invalid={Boolean(errors.addresseePubkey)}
        disabled={
          locked || recipientLoading || recipientError || channelPeople === 0
        }
        id="ask-addressee"
        onChange={(event) =>
          onUpdateDraft("addresseePubkey", event.target.value)
        }
        value={draft.addresseePubkey}
      >
        <option value="">Choose recipient</option>
        {recipientOptions.map((member) => (
          <option key={member.pubkey} value={member.pubkey}>
            {member.label}
          </option>
        ))}
      </select>
      {errors.addresseePubkey ? (
        <span
          className="colony-ask-compose-error"
          id="ask-addressee-error"
          role="alert"
        >
          {errors.addresseePubkey}
        </span>
      ) : null}

      <label htmlFor="hire-role-pack">Role pack</label>
      <select
        aria-describedby={
          errors.hireRolePackId ? "hire-role-pack-error" : undefined
        }
        aria-invalid={Boolean(errors.hireRolePackId)}
        disabled={locked || !roleOptionsReady}
        id="hire-role-pack"
        onChange={(event) =>
          onUpdateDraft("hireRolePackId", event.target.value)
        }
        value={draft.hireRolePackId}
      >
        <option value="">Choose role pack</option>
        {roleOptions.map((option) => (
          <option key={option.persona.id} value={option.persona.id}>
            {option.rolePack.title}
          </option>
        ))}
      </select>
      {roleOptionsPending ? (
        <p role="status">Loading role packs…</p>
      ) : roleOptionsError ? (
        <div role="alert">
          <p>Role packs could not load. Your draft is kept.</p>
          <Button
            onClick={() => void onRetryRoleOptions()}
            type="button"
            variant="outline"
          >
            Retry role packs
          </Button>
        </div>
      ) : roleOptions.length === 0 ? (
        <div role="status">
          <p>No role pack is available.</p>
          <Button
            onClick={() => void onOpenRoleCatalog()}
            type="button"
            variant="outline"
          >
            No role available? Open catalog
          </Button>
        </div>
      ) : null}
      {errors.hireRolePackId ? (
        <span
          className="colony-ask-compose-error"
          id="hire-role-pack-error"
          role="alert"
        >
          {errors.hireRolePackId}
        </span>
      ) : null}
      {selectedHireRole ? (
        <>
          <div className="colony-ask-hire-fields">
            <div>
              <label htmlFor="hire-name">Proposed name</label>
              <Input
                aria-describedby={
                  errors.hireName ? "hire-name-error" : undefined
                }
                aria-invalid={Boolean(errors.hireName)}
                disabled={locked}
                id="hire-name"
                maxLength={120}
                onChange={(event) =>
                  onUpdateDraft("hireName", event.target.value)
                }
                value={draft.hireName}
              />
              {errors.hireName ? (
                <span
                  className="colony-ask-compose-error"
                  id="hire-name-error"
                  role="alert"
                >
                  {errors.hireName}
                </span>
              ) : null}
            </div>
            <div>
              <label htmlFor="hire-title">Job title</label>
              <Input
                aria-describedby={
                  errors.hireTitle ? "hire-title-error" : undefined
                }
                aria-invalid={Boolean(errors.hireTitle)}
                disabled={locked}
                id="hire-title"
                maxLength={120}
                onChange={(event) =>
                  onUpdateDraft("hireTitle", event.target.value)
                }
                value={draft.hireTitle}
              />
              {errors.hireTitle ? (
                <span
                  className="colony-ask-compose-error"
                  id="hire-title-error"
                  role="alert"
                >
                  {errors.hireTitle}
                </span>
              ) : null}
            </div>
          </div>

          <label htmlFor="hire-reason">Reason</label>
          <textarea
            aria-describedby={
              errors.hireReason
                ? "hire-reason-error hire-reason-count"
                : "hire-reason-count"
            }
            aria-invalid={Boolean(errors.hireReason)}
            disabled={locked}
            id="hire-reason"
            maxLength={1000}
            onChange={(event) =>
              onUpdateDraft("hireReason", event.target.value)
            }
            rows={4}
            value={draft.hireReason}
          />
          <small id="hire-reason-count">
            {Array.from(draft.hireReason).length} / 1,000 characters · Required
          </small>
          {errors.hireReason ? (
            <span
              className="colony-ask-compose-error"
              id="hire-reason-error"
              role="alert"
            >
              {errors.hireReason}
            </span>
          ) : null}

          <div className="colony-ask-hire-fields">
            <div>
              <label htmlFor="hire-allowance">Requested allowance, USD</label>
              <Input
                aria-describedby={
                  errors.hireAllowance ? "hire-allowance-error" : undefined
                }
                aria-invalid={Boolean(errors.hireAllowance)}
                disabled={locked}
                id="hire-allowance"
                min="0.01"
                onChange={(event) =>
                  onUpdateDraft("hireAllowance", event.target.value)
                }
                step="0.01"
                type="number"
                value={draft.hireAllowance}
              />
              {errors.hireAllowance ? (
                <span
                  className="colony-ask-compose-error"
                  id="hire-allowance-error"
                  role="alert"
                >
                  {errors.hireAllowance}
                </span>
              ) : null}
            </div>
            <div>
              <label htmlFor="hire-allowance-period">Allowance period</label>
              <select
                aria-describedby={
                  errors.hireAllowancePeriod
                    ? "hire-allowance-period-error"
                    : undefined
                }
                aria-invalid={Boolean(errors.hireAllowancePeriod)}
                disabled={locked}
                id="hire-allowance-period"
                onChange={(event) =>
                  onUpdateDraft(
                    "hireAllowancePeriod",
                    event.target
                      .value as AskComposerDraft["hireAllowancePeriod"],
                  )
                }
                value={draft.hireAllowancePeriod}
              >
                <option value="">Choose allowance period</option>
                <option disabled value="day">
                  Day
                </option>
                <option value="week">Week</option>
                <option disabled value="month">
                  Month
                </option>
              </select>
              {errors.hireAllowancePeriod ? (
                <span
                  className="colony-ask-compose-error"
                  id="hire-allowance-period-error"
                  role="alert"
                >
                  {errors.hireAllowancePeriod}
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

export function HireProposalReviewSteps() {
  return (
    <>
      <h2>A proposal, then a decision</h2>
      <ol className="colony-ask-hire-steps">
        <li>
          <strong>Describe the need</strong>
          <p>Choose a curated role and explain the work.</p>
        </li>
        <li>
          <strong>Review the request</strong>
          <p>An authorized human reviews the scope and allowance.</p>
        </li>
        <li>
          <strong>Founder signs off</strong>
          <p>Creating the position remains a separate, explicit action.</p>
        </li>
      </ol>
    </>
  );
}
