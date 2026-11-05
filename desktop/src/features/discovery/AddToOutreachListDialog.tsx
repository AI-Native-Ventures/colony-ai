import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { LeadContext } from "./leadShared";
import { canEdit } from "./leadShared";
import { publishOutreachListAction } from "./businessRecordMutations";
import {
  buildOutreachListCreateAction,
  buildOutreachListMutation,
} from "./outreachRecords";
import { errorMessage } from "./BusinessCommon";

const NEW_LIST = "__new__";

function listUsageLabel(
  list: LeadContext["records"]["outreachLists"][number],
  campaigns: LeadContext["records"]["discoveryCampaigns"],
  now: number,
): string {
  const ageSeconds = Math.max(0, now - list.record.updatedAt);
  if (ageSeconds < 24 * 60 * 60) return "used today";
  if (list.record.source.campaignId) {
    const campaign = campaigns.find(
      ({ record }) => record.campaignId === list.record.source.campaignId,
    );
    if (campaign) return `from ${campaign.record.name}`;
  }
  const weeks = Math.floor(ageSeconds / (7 * 24 * 60 * 60));
  if (weeks > 0) return `used ${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const days = Math.floor(ageSeconds / (24 * 60 * 60));
  return `used ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function AddToOutreachListDialog({
  context,
  defaultName,
  description = "You and Scout can mention this shared list in any chat.",
  existingListId,
  leadIds,
  onOpenChange,
  open,
  sourceCampaignId,
}: {
  context: LeadContext;
  defaultName: string;
  description?: string;
  existingListId?: string;
  leadIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sourceCampaignId?: string;
}) {
  const lists = context.records.outreachLists
    .filter(({ record }) => record.status === "active")
    .sort((left, right) => right.record.updatedAt - left.record.updatedAt);
  const initialList = existingListId ?? NEW_LIST;
  const [target, setTarget] = React.useState(initialList);
  const [name, setName] = React.useState(defaultName);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const canWrite = canEdit(context.role);

  React.useEffect(() => {
    if (!open) return;
    setTarget(initialList);
    setName(defaultName);
    setError("");
  }, [defaultName, initialList, open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !context.currentPubkey || leadIds.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (target === NEW_LIST) {
        const listId = crypto.randomUUID();
        const action = buildOutreachListCreateAction({
          listId,
          name,
          source: sourceCampaignId
            ? { kind: "campaign", campaignId: sourceCampaignId }
            : { kind: "manual" },
          leadIds: [...leadIds],
        });
        await publishOutreachListAction({
          channelId: context.channelId,
          communityId: context.communityId,
          action,
        });
      } else {
        const list = lists.find(({ record }) => record.listId === target);
        if (!list) throw new Error("Choose an available outreach list.");
        const action = buildOutreachListMutation({
          listId: list.record.listId,
          expectedHeadEventId: list.eventId,
          op: "add_members",
          leadIds: [...leadIds],
        });
        await publishOutreachListAction({
          channelId: context.channelId,
          communityId: context.communityId,
          action,
        });
      }
      try {
        await context.refresh();
      } catch {
        // The relay acknowledged the action. Its live subscription can refresh
        // the new head after a temporary read failure.
      }
      onOpenChange(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3l-dialog-content c3l-outreach-list-dialog"
        data-testid="outreach-list-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Add {leadIds.length} {leadIds.length === 1 ? "lead" : "leads"} to an
            outreach list
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="c3l-outreach-dialog-form" onSubmit={save}>
          <fieldset className="c3l-outreach-list-options">
            <legend>Choose a list</legend>
            <div
              className={`c3l-outreach-list-option c3l-outreach-new-option${target === NEW_LIST ? " is-selected" : ""}`}
            >
              <label>
                <input
                  checked={target === NEW_LIST}
                  disabled={busy}
                  name="outreach-list-target"
                  onChange={() => setTarget(NEW_LIST)}
                  type="radio"
                  value={NEW_LIST}
                />
                <span className="c3l-outreach-list-option-copy">
                  <strong>New list</strong>
                </span>
              </label>
              {target === NEW_LIST ? (
                <div className="c3l-outreach-dialog-field">
                  <input
                    aria-label="New list name"
                    autoFocus
                    disabled={busy}
                    id="outreach-list-name"
                    maxLength={80}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                    value={name}
                  />
                </div>
              ) : null}
            </div>
            {lists.map((list) => {
              const { record } = list;
              return (
                <label
                  className={`c3l-outreach-list-option${target === record.listId ? " is-selected" : ""}`}
                  key={record.listId}
                >
                  <input
                    checked={target === record.listId}
                    disabled={busy}
                    name="outreach-list-target"
                    onChange={() => setTarget(record.listId)}
                    type="radio"
                    value={record.listId}
                  />
                  <span className="c3l-outreach-list-option-copy">
                    <strong>{record.name}</strong>
                    <small>
                      {record.members.length}{" "}
                      {record.members.length === 1 ? "lead" : "leads"} ·{" "}
                      {listUsageLabel(
                        list,
                        context.records.discoveryCampaigns,
                        Math.floor(Date.now() / 1_000),
                      )}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error ? (
            <p className="c3l-outreach-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="c3l-outreach-dialog-actions">
            <button
              className="c3l-btn c3l-btn-outline c3l-btn-small"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3l-btn c3l-btn-primary c3l-btn-small"
              disabled={busy || !canWrite || leadIds.length === 0}
              type="submit"
            >
              {busy
                ? "Adding…"
                : target === NEW_LIST
                  ? "Create list"
                  : "Add to list"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
