import { useState } from "react";
import { Link } from "@tanstack/react-router";

import type { NeedsYouItem } from "../needsYou";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";

import { playbookActions, playbookJobActions } from "../playbookActions";
import type { NeedsYouAction } from "../needsYou";
import {
  usePlaybookAction,
  usePlaybookJobAction,
  usePlaybooksQuery,
} from "../playbookHooks";
import { useNeedsYouQuery } from "../needsYouHooks";
import "./needsYouPlaybookList.css";

function isPlaybookItem(item: NeedsYouItem): boolean {
  return item.source.kind === "playbook" || item.source.kind === "playbook_job";
}

export function NeedsYouPlaybookList() {
  const query = useNeedsYouQuery();
  const playbooksQuery = usePlaybooksQuery();
  const membership = useMyRelayMembershipQuery();
  const playbookAction = usePlaybookAction();
  const jobAction = usePlaybookJobAction();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canApprove =
    membership.data?.role === "owner" || membership.data?.role === "admin";
  const items = [...query.model.approve, ...query.model.do].filter(
    isPlaybookItem,
  );

  async function runAction(item: NeedsYouItem, action: NeedsYouAction) {
    if (pendingId || !canApprove) return;
    setPendingId(item.id);
    setActionError(null);
    try {
      const source = item.source;
      if (source.kind === "playbook") {
        const playbook = playbooksQuery.data?.playbooks.find(
          (candidate) => candidate.playbookId === source.playbookId,
        );
        if (!playbook?.pending) {
          throw new Error("This playbook changed. Refresh and try again.");
        }
        if (action.id === "approve") {
          await playbookAction.mutateAsync(playbookActions.approve(playbook));
        } else if (action.id === "reject") {
          await playbookAction.mutateAsync(playbookActions.reject(playbook));
        }
      } else if (source.kind === "playbook_job") {
        const job = playbooksQuery.data?.jobs.find(
          (candidate) => candidate.jobId === source.jobId,
        );
        if (!job || job.currentStepId !== source.stepId) {
          throw new Error("This client job changed. Refresh and try again.");
        }
        if (action.id === "approve") {
          await jobAction.mutateAsync(
            playbookJobActions.approveStep(job, source.stepId),
          );
        } else if (action.id === "reject") {
          await jobAction.mutateAsync(
            playbookJobActions.rejectStep(job, source.stepId),
          );
        } else if (action.id === "done") {
          await jobAction.mutateAsync(
            playbookJobActions.markDone(job, source.stepId),
          );
        }
      }
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "The playbook item could not be updated. Try again.",
      );
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0 && !query.isPending && !query.error) return null;

  return (
    <section
      aria-label="Needs you"
      className="ct-needs"
      data-testid="today-playbook-needs-you"
    >
      <div className="ct-needs-head">
        <h2>Needs you</h2>
        <span className="ct-needs-count">
          {query.error
            ? "Playbook items unavailable"
            : `${items.length} playbook ${items.length === 1 ? "item" : "items"}`}
        </span>
      </div>

      {query.error ? (
        <div className="ct-error" role="alert">
          <p>Playbook approvals could not be loaded.</p>
          <button
            className="ct-button"
            onClick={() => void query.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {query.isPending ? (
        <p className="ct-state">Loading playbook items…</p>
      ) : null}

      {actionError ? (
        <p className="ct-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="ct-group">
          {items.map((item) => {
            const actions = item.actions.filter((action) =>
              ["approve", "reject", "done"].includes(action.id),
            );
            return (
              <article
                className="ct-playbook-need"
                data-testid={`today-playbook-need-${item.id}`}
                key={item.id}
              >
                <Link
                  className="ct-playbook-need-open"
                  params={{ function: "operations" }}
                  to="/company/function/$function"
                >
                  <strong>{item.title}</strong>
                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                </Link>
                <div className="ct-playbook-need-actions">
                  <span className="ct-chip" data-tone="need">
                    Needs you
                  </span>
                  {actions.map((action) => (
                    <button
                      className="ct-button ct-playbook-action"
                      data-tone={action.tone}
                      disabled={!canApprove || pendingId !== null}
                      key={action.id}
                      onClick={() => void runAction(item, action)}
                      type="button"
                    >
                      {pendingId === item.id ? "Saving…" : action.label}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {items.length === 0 && !query.isPending && !query.error ? (
        <p className="ct-state">No playbook items are waiting for you.</p>
      ) : null}
    </section>
  );
}
