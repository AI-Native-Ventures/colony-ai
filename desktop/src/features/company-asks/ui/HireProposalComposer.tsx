import * as React from "react";

import { companyHireRolePackFromPersona } from "@/features/company-hiring/companyHireModels";
import type { AgentPersona } from "@/shared/api/types";

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

type AskHireRecipientOption = {
  pubkey: string;
  label: string;
  /** The person's company role, shown beside the name ("Founder"). */
  role?: string;
};
type AskHireChannelOption = { id: string; name: string };
type AskHireThreadOption = { id: string; label: string };
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
  channelOptions: AskHireChannelOption[];
  selectedChannelId: string;
  selectedThreadRootId: string;
  startNewThread: boolean;
  threadOptions: AskHireThreadOption[];
  threadsPending: boolean;
  threadsError: boolean;
  proposalDestination: string;
  locked: boolean;
  onUpdateDraft: UpdateAskDraft;
  onChangeChannel: (channelId: string) => void;
  onChangeThread: (threadRootId: string) => void;
  onRetryThreads: () => void;
  onRetryRoleOptions: () => void;
  onOpenRoleCatalog: () => void;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="ask3-error" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

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
  channelOptions,
  selectedChannelId,
  selectedThreadRootId,
  startNewThread,
  threadOptions,
  threadsPending,
  threadsError,
  proposalDestination,
  locked,
  onUpdateDraft,
  onChangeChannel,
  onChangeThread,
  onRetryThreads,
  onRetryRoleOptions,
  onOpenRoleCatalog,
}: HireProposalComposerProps) {
  if (hireProposalReview && selectedHireRole) {
    return (
      <div className="ask3-hire-review">
        <h2 className="ask3-heading-2">Review hire proposal</h2>
        <dl className="ask3-rows" data-layout="split">
          <div className="ask3-row">
            <dt>Role pack</dt>
            <dd>{selectedHireRole.rolePack.title}</dd>
          </div>
          <div className="ask3-row">
            <dt>Name</dt>
            <dd>{draft.hireName.trim()}</dd>
          </div>
          <div className="ask3-row">
            <dt>Title</dt>
            <dd>{draft.hireTitle.trim()}</dd>
          </div>
          <div className="ask3-row">
            <dt>Allowance request</dt>
            <dd>USD {draft.hireAllowance.trim()} / week</dd>
          </div>
          <div className="ask3-row">
            <dt>Reason</dt>
            <dd>{draft.hireReason.trim()}</dd>
          </div>
          <div className="ask3-row">
            <dt>Destination</dt>
            <dd>{proposalDestination}</dd>
          </div>
        </dl>
        <p className="ask3-hint">
          Submitting proposes a hire. Only the founder can complete sign-off.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="ask3-grid" data-min="200">
        <div className="ask3-field">
          <label htmlFor="ask-channel">Channel</label>
          <select
            className="ask3-control"
            disabled={locked}
            id="ask-channel"
            onChange={(event) => onChangeChannel(event.target.value)}
            value={selectedChannelId}
          >
            <option value="">Choose channel</option>
            {channelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                # {option.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ask3-field">
          <label htmlFor="ask-thread">Thread</label>
          <select
            className="ask3-control"
            disabled={locked || threadsPending || threadsError}
            id="ask-thread"
            onChange={(event) => onChangeThread(event.target.value)}
            value={startNewThread ? "new" : selectedThreadRootId}
          >
            {startNewThread ? (
              <option value="new">New thread</option>
            ) : (
              <option value="">Choose thread</option>
            )}
            {threadOptions.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ask3-field">
          <label htmlFor="ask-addressee">Recipient</label>
          <select
            aria-describedby={
              errors.addresseePubkey ? "ask-addressee-error" : undefined
            }
            aria-invalid={Boolean(errors.addresseePubkey)}
            className="ask3-control"
            disabled={
              locked ||
              recipientLoading ||
              recipientError ||
              channelPeople === 0
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
                {member.role
                  ? `${member.label} · ${member.role}`
                  : member.label}
              </option>
            ))}
          </select>
          <FieldError
            id="ask-addressee-error"
            message={errors.addresseePubkey}
          />
        </div>
      </div>
      {threadsError ? (
        <div className="ask3-notice" data-tone="bad" role="alert">
          <p>Threads could not load. Your draft is kept.</p>
          <button
            className="ask3-btn"
            data-size="42"
            data-variant="secondary"
            onClick={onRetryThreads}
            type="button"
          >
            Retry threads
          </button>
        </div>
      ) : null}

      <div className="ask3-field">
        <label htmlFor="hire-role-pack">Role pack</label>
        <select
          aria-describedby={
            errors.hireRolePackId ? "hire-role-pack-error" : undefined
          }
          aria-invalid={Boolean(errors.hireRolePackId)}
          className="ask3-control"
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
          <p className="ask3-state-text" role="status">
            Loading role packs…
          </p>
        ) : roleOptionsError ? (
          <div className="ask3-notice" data-tone="bad" role="alert">
            <p>Role packs could not load. Your draft is kept.</p>
            <button
              className="ask3-btn"
              data-size="42"
              data-variant="secondary"
              onClick={() => void onRetryRoleOptions()}
              type="button"
            >
              Retry role packs
            </button>
          </div>
        ) : (
          <span className="ask3-hint">
            No role available?{" "}
            <button
              className="ask3-link-button"
              onClick={() => void onOpenRoleCatalog()}
              type="button"
            >
              Open catalog
            </button>
          </span>
        )}
        <FieldError id="hire-role-pack-error" message={errors.hireRolePackId} />
      </div>

      {selectedHireRole ? (
        <>
          <div className="ask3-grid" data-min="240">
            <div className="ask3-field">
              <label htmlFor="hire-name">Proposed name</label>
              <input
                aria-describedby={
                  errors.hireName ? "hire-name-error" : undefined
                }
                aria-invalid={Boolean(errors.hireName)}
                className="ask3-control"
                disabled={locked}
                id="hire-name"
                maxLength={120}
                onChange={(event) =>
                  onUpdateDraft("hireName", event.target.value)
                }
                value={draft.hireName}
              />
              <FieldError id="hire-name-error" message={errors.hireName} />
            </div>
            <div className="ask3-field">
              <label htmlFor="hire-title">Job title</label>
              <input
                aria-describedby={
                  errors.hireTitle ? "hire-title-error" : undefined
                }
                aria-invalid={Boolean(errors.hireTitle)}
                className="ask3-control"
                disabled={locked}
                id="hire-title"
                maxLength={120}
                onChange={(event) =>
                  onUpdateDraft("hireTitle", event.target.value)
                }
                value={draft.hireTitle}
              />
              <FieldError id="hire-title-error" message={errors.hireTitle} />
            </div>
          </div>

          <div className="ask3-field">
            <label htmlFor="hire-reason">Reason</label>
            <textarea
              aria-describedby={
                errors.hireReason
                  ? "hire-reason-error hire-reason-count"
                  : "hire-reason-count"
              }
              aria-invalid={Boolean(errors.hireReason)}
              className="ask3-textarea"
              data-leading="155"
              disabled={locked}
              id="hire-reason"
              maxLength={1000}
              onChange={(event) =>
                onUpdateDraft("hireReason", event.target.value)
              }
              rows={3}
              value={draft.hireReason}
            />
            <span className="ask3-hint" id="hire-reason-count">
              {Array.from(draft.hireReason).length} / 1,000 characters ·
              Required
            </span>
            <FieldError id="hire-reason-error" message={errors.hireReason} />
          </div>

          <div className="ask3-grid" data-min="240">
            <div className="ask3-field">
              <label htmlFor="hire-allowance">Requested allowance, USD</label>
              <input
                aria-describedby={
                  errors.hireAllowance ? "hire-allowance-error" : undefined
                }
                aria-invalid={Boolean(errors.hireAllowance)}
                className="ask3-control"
                disabled={locked}
                id="hire-allowance"
                min="0.01"
                onChange={(event) =>
                  onUpdateDraft("hireAllowance", event.target.value)
                }
                placeholder="[AMOUNT]"
                step="0.01"
                type="number"
                value={draft.hireAllowance}
              />
              <FieldError
                id="hire-allowance-error"
                message={errors.hireAllowance}
              />
            </div>
            <div className="ask3-field">
              <label htmlFor="hire-allowance-period">Allowance period</label>
              <select
                aria-describedby={
                  errors.hireAllowancePeriod
                    ? "hire-allowance-period-error"
                    : undefined
                }
                aria-invalid={Boolean(errors.hireAllowancePeriod)}
                className="ask3-control"
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
                <option value="week">Week</option>
                <option disabled value="month">
                  Month (not available yet)
                </option>
              </select>
              <FieldError
                id="hire-allowance-period-error"
                message={errors.hireAllowancePeriod}
              />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/** The three-step side panel of the Propose a hire board. */
export function HireProposalReviewSteps() {
  const steps = [
    {
      title: "Describe the need",
      copy: "Say what the role is for and what it may spend.",
    },
    {
      title: "Review the request",
      copy: "An owner or administrator checks the scope and allowance.",
    },
    {
      title: "Founder signs off",
      copy: "Only the founder can open the position.",
    },
  ];
  return (
    <>
      <h2 className="ask3-aside-title" id="proposal-steps">
        A proposal, then a decision
      </h2>
      <ol className="ask3-flow">
        {steps.map((step, index) => (
          <li
            aria-current={index === 0 ? "step" : undefined}
            className="ask3-flow-step"
            key={step.title}
          >
            <span className="ask3-flow-rail">
              <span className="ask3-flow-dot">{index + 1}</span>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="ask3-flow-line" />
              ) : null}
            </span>
            <span className="ask3-flow-copy">
              <strong>{step.title}</strong>
              <span>{step.copy}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
