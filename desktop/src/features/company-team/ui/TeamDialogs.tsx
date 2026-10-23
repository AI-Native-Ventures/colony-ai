import * as React from "react";

import {
  isManagedAgentActive,
  stopManagedAgentWithRules,
} from "@/features/agents/lib/managedAgentControlActions";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import { clearActiveTurnsForAgentOnStop } from "@/features/agents/managedAgentRuntimeHooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  effectiveAllowanceAt,
  formatUsdCents,
} from "@/features/power/spendModels";
import { useEmployeeAllowanceHeadsQuery } from "@/features/power/spendRelay";
import {
  useUpdateProfileMutation,
  useUsersBatchQuery,
} from "@/features/profile/hooks";
import { resolveJobTitle } from "@/features/profile/lib/jobTitle";
import { useIdentityQuery } from "@/shared/api/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  useCompanyTeamQuery,
  useMemberPositionActionMutation,
} from "../teamRelay";
import type { TeamMember } from "../teamModels";
import { EmployeeAvatar } from "./EmployeeAvatar";
import "./TeamDialogs.css";

export type TeamDialogProps = {
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function useMemberName(member: TeamMember) {
  const profiles = useUsersBatchQuery([member.pubkey]);
  return (
    profiles.data?.profiles[member.pubkey]?.displayName?.trim() ||
    member.fallbackName?.trim() ||
    truncateNpub(member.pubkey)
  );
}

function kindLabel(member: TeamMember) {
  return member.kind === "employee" ? "AI employee" : "Human";
}

/**
 * The 400px dialog surface. Focus rests on the surface itself, not the close
 * button, so no ring is drawn until someone tabs into the form.
 */
function TeamDialogSurface({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  return (
    <DialogContent
      className="team-dialog"
      data-testid={testId}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        ref.current?.focus();
      }}
      ref={ref}
      showCloseButton={false}
    >
      {children}
    </DialogContent>
  );
}

function DialogHeading({
  closeLabel = "Close",
  subtitle,
  title,
}: {
  closeLabel?: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="team-dialog-head">
      <div className="team-dialog-heading">
        <DialogTitle className="team-dialog-title">{title}</DialogTitle>
        <DialogDescription className="team-dialog-subtitle">
          {subtitle}
        </DialogDescription>
      </div>
      <DialogClose className="team-dialog-close" type="button">
        <CloseIcon size={16} strokeWidth={2.4} />
        <span className="sr-only">{closeLabel}</span>
      </DialogClose>
    </div>
  );
}

function descendantsOf(rootPubkey: string, members: readonly TeamMember[]) {
  const found = new Set([rootPubkey.toLowerCase()]);
  for (let round = 0; round < members.length; round += 1) {
    const before = found.size;
    for (const candidate of members) {
      const manager = candidate.position?.head.managerPubkey;
      if (manager && found.has(manager)) found.add(candidate.pubkey);
    }
    if (found.size === before) break;
  }
  return found;
}

function memberStatus(candidate: TeamMember) {
  return (
    candidate.position?.head.status ??
    (candidate.kind === "human" ? "active" : "unknown")
  );
}

/** Edit a person's job title and who they report to, as a dialog. */
export function EditRoleReportingDialog({
  member,
  open,
  onOpenChange,
}: TeamDialogProps) {
  const teamQuery = useCompanyTeamQuery();
  const identity = useIdentityQuery();
  const mutation = useMemberPositionActionMutation();
  const updateProfile = useUpdateProfileMutation();
  const name = useMemberName(member);
  const members = teamQuery.data?.members ?? [];
  const profiles = useUsersBatchQuery(
    members.map((candidate) => candidate.pubkey),
    { enabled: members.length > 0 },
  ).data?.profiles;
  const nameOf = (candidate: TeamMember) =>
    profiles?.[candidate.pubkey]?.displayName?.trim() ||
    candidate.fallbackName?.trim() ||
    truncateNpub(candidate.pubkey);
  // The title on the person's own profile leads; the position title backs it.
  const currentTitle = resolveJobTitle({
    positionTitle: member.position?.head.title,
    profile: profiles?.[member.pubkey],
  });
  const currentManager = member.position?.head.managerPubkey ?? "";
  const [title, setTitle] = React.useState(currentTitle);
  const [manager, setManager] = React.useState(currentManager);
  const [error, setError] = React.useState<string | null>(null);
  const initialized = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      initialized.current = null;
      return;
    }
    const key = `${member.pubkey}:${member.position?.event.id ?? "new"}:${currentTitle}`;
    if (initialized.current === key) return;
    initialized.current = key;
    setTitle(currentTitle);
    setManager(currentManager);
    setError(null);
  }, [
    open,
    member.pubkey,
    member.position?.event.id,
    currentTitle,
    currentManager,
  ]);

  const blocked = descendantsOf(member.pubkey, members);
  const isSelf =
    identity.data?.pubkey.toLowerCase() === member.pubkey.toLowerCase();
  const role = teamQuery.data?.relayMembers.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === identity.data?.pubkey.toLowerCase(),
  )?.role;
  const canManage = role === "owner" || role === "admin";
  const saving = mutation.isPending || updateProfile.isPending;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextTitle = title.trim();
    if (!nextTitle) return;
    try {
      if (canManage) {
        await mutation.mutateAsync({
          schemaVersion: 1,
          pubkey: member.pubkey,
          action: "set_position",
          ...(member.position
            ? { expectedHeadEventId: member.position.event.id }
            : {}),
          title: nextTitle,
          managerPubkey: manager || null,
        });
      }
      // A person's own job title also lives on their profile, so every client
      // sees it; only they can sign that change.
      if (isSelf && member.kind === "human") {
        await updateProfile.mutateAsync({ jobTitle: nextTitle });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to save changes.",
      );
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <TeamDialogSurface testId="team-dialog-edit-role">
        <form
          className="team-dialog-form"
          onSubmit={(event) => void save(event)}
        >
          <DialogHeading
            subtitle={`${name} · ${kindLabel(member)}`}
            title="Edit role and reporting"
          />
          <label className="team-dialog-field" htmlFor="team-member-name">
            Name
            <input
              className="team-dialog-input"
              data-readonly="true"
              id="team-member-name"
              readOnly
              value={name}
            />
          </label>
          <label className="team-dialog-field" htmlFor="team-member-title">
            Title
            <input
              className="team-dialog-input"
              id="team-member-title"
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className="team-dialog-field" htmlFor="team-member-manager">
            Reports to
            <select
              className="team-dialog-input team-dialog-select"
              id="team-member-manager"
              disabled={!canManage}
              onChange={(event) => setManager(event.target.value)}
              value={manager}
            >
              <option value="">Company owner</option>
              {manager && !members.some((c) => c.pubkey === manager) ? (
                <option disabled value={manager}>
                  {truncateNpub(manager)} · unavailable
                </option>
              ) : null}
              {members
                .filter(
                  (candidate) =>
                    candidate.pubkey === manager ||
                    (!blocked.has(candidate.pubkey) &&
                      memberStatus(candidate) === "active"),
                )
                .map((candidate) => (
                  <option
                    disabled={
                      blocked.has(candidate.pubkey) ||
                      memberStatus(candidate) !== "active"
                    }
                    key={candidate.pubkey}
                    value={candidate.pubkey}
                  >
                    {nameOf(candidate)}
                  </option>
                ))}
            </select>
          </label>
          <p className="team-dialog-note">
            This changes reporting responsibilities only. It doesn’t grant
            spending or credential authority.
          </p>
          {error ? (
            <p className="team-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="team-dialog-actions">
            <button
              className="team-dialog-button"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="team-dialog-button"
              data-variant="primary"
              disabled={saving || !title.trim()}
              type="submit"
            >
              {saving ? "Saving" : "Save changes"}
            </button>
          </div>
        </form>
      </TeamDialogSurface>
    </Dialog>
  );
}

/** Stop an employee's position and active runtime, with a reason. */
export function TerminateEmployeeDialog({
  member,
  open,
  onOpenChange,
}: TeamDialogProps) {
  const teamQuery = useCompanyTeamQuery();
  const mutation = useMemberPositionActionMutation();
  const stopMutation = useStopManagedAgentMutation();
  const managedAgentsQuery = useManagedAgentsQuery({ enabled: open });
  const relayAgentsQuery = useRelayAgentsQuery({ enabled: open });
  const channelsQuery = useChannelsQuery({ enabled: open });
  const name = useMemberName(member);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const alreadyTerminated = member.position?.head.status === "terminated";

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  async function terminate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!member.position) {
      setError(
        "Set a title and reporting line before changing employee status.",
      );
      return;
    }
    if (!alreadyTerminated && !reason.trim()) {
      setError("Enter a reason to continue.");
      return;
    }
    setStopping(true);
    try {
      if (!alreadyTerminated) {
        await mutation.mutateAsync({
          schemaVersion: 1,
          pubkey: member.pubkey,
          action: "terminate",
          expectedHeadEventId: member.position.event.id,
          reason: reason.trim(),
        });
      }
      const managedResult = managedAgentsQuery.data
        ? { data: managedAgentsQuery.data, error: null }
        : await managedAgentsQuery.refetch();
      if (managedResult.error) throw managedResult.error;
      const managedAgent = managedResult.data?.find(
        (candidate) => candidate.pubkey.toLowerCase() === member.pubkey,
      );
      if (managedAgent && isManagedAgentActive(managedAgent)) {
        const channels =
          channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
        const relayAgents =
          relayAgentsQuery.data ??
          (await relayAgentsQuery.refetch()).data ??
          [];
        const result = await stopManagedAgentWithRules({
          agent: managedAgent,
          channels,
          relayAgents,
          stopManagedAgent: stopMutation.mutateAsync,
        });
        if (result.noticeMessage) throw new Error(result.noticeMessage);
        clearActiveTurnsForAgentOnStop(member.pubkey);
      }
      const refreshed = await teamQuery.refetch();
      if (refreshed.error) throw refreshed.error;
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to update employee status.",
      );
    } finally {
      setStopping(false);
    }
  }

  const busy = stopping || mutation.isPending;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <TeamDialogSurface testId="team-dialog-terminate">
        <form
          className="team-dialog-form"
          onSubmit={(event) => void terminate(event)}
        >
          <DialogHeading
            subtitle={`${name} · ${member.position?.head.title || kindLabel(member)}`}
            title="Terminate employee"
          />
          <label className="team-dialog-field" htmlFor="team-status-reason">
            Reason
            <textarea
              className="team-dialog-input team-dialog-textarea"
              id="team-status-reason"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this position ending?"
              required={!alreadyTerminated}
              rows={4}
              value={reason}
            />
          </label>
          <div className="team-dialog-warning">
            <svg
              aria-hidden="true"
              fill="none"
              height="1.125rem"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.4}
              viewBox="0 0 24 24"
              width="1.125rem"
            >
              <path d="M12 4 21 19.5H3z" />
              <path d="M12 10v4M12 17v.2" />
            </svg>
            <span>
              {name}’s active work stops now. This can’t be undone from this
              screen, but you can review a rehire later.
            </span>
          </div>
          {error ? (
            <p className="team-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="team-dialog-actions">
            <button
              className="team-dialog-button"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="team-dialog-button"
              data-variant="danger"
              disabled={busy || (!alreadyTerminated && !reason.trim())}
              type="submit"
            >
              {busy
                ? "Saving"
                : alreadyTerminated
                  ? "Retry stopping runtime"
                  : "Terminate employee"}
            </button>
          </div>
        </form>
      </TeamDialogSurface>
    </Dialog>
  );
}

/** Review the retained position, then approve bringing the employee back. */
export function ReviewRehireDialog({
  member,
  open,
  onOpenChange,
}: TeamDialogProps) {
  const teamQuery = useCompanyTeamQuery();
  const mutation = useMemberPositionActionMutation();
  const allowances = useEmployeeAllowanceHeadsQuery(open);
  const name = useMemberName(member);
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const members = teamQuery.data?.members ?? [];
  const managerPubkey = member.position?.head.managerPubkey;
  const manager = managerPubkey
    ? members.find((candidate) => candidate.pubkey === managerPubkey)
    : null;
  const profiles = useUsersBatchQuery(managerPubkey ? [managerPubkey] : [], {
    enabled: Boolean(managerPubkey),
  }).data?.profiles;
  const managerName = managerPubkey
    ? profiles?.[managerPubkey]?.displayName?.trim() ||
      manager?.fallbackName?.trim() ||
      truncateNpub(managerPubkey)
    : "Company owner";
  const allowanceHead = allowances.data?.records.find(
    (record) => record.head.employeePubkey?.toLowerCase() === member.pubkey,
  );
  const allowance = allowanceHead
    ? effectiveAllowanceAt(allowanceHead.head, new Date()).allowance
    : null;

  React.useEffect(() => {
    if (open) {
      setApproved(false);
      setError(null);
    }
  }, [open]);

  async function rehire(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member.position) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        pubkey: member.pubkey,
        action: "rehire",
        expectedHeadEventId: member.position.event.id,
      });
      onOpenChange(false);
    } catch {
      setError("Rehire could not be published. The review is kept. Try again.");
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <TeamDialogSurface testId="team-dialog-rehire">
        <form
          className="team-dialog-form"
          onSubmit={(event) => void rehire(event)}
        >
          <DialogHeading
            subtitle={`${name} · ${member.position?.head.title || kindLabel(member)}`}
            title="Review rehire"
          />
          <div className="team-dialog-summary">
            <EmployeeAvatar
              className="team-dialog-summary-avatar"
              definition={member.managedAgent?.avatarUrl}
              name={name}
              personaId={member.managedAgent?.personaId}
            />
            <dl>
              <dt>Reports to</dt>
              <dd>{managerName}</dd>
              {allowance ? (
                <>
                  <dt>Allowance</dt>
                  <dd>
                    USD {formatUsdCents(allowance.amountCents)} /{" "}
                    {allowance.period}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
          <p className="team-dialog-body">
            {name} comes back with the same role, reporting line and tools it
            had before. Its memory and lessons are kept.
          </p>
          <label className="team-dialog-check">
            <input
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
              type="checkbox"
            />
            I approve rehiring {name} in this position.
          </label>
          {error ? (
            <p className="team-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="team-dialog-actions">
            <button
              className="team-dialog-button"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="team-dialog-button"
              data-variant="primary"
              disabled={!approved || mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Saving" : "Approve and rehire"}
            </button>
          </div>
        </form>
      </TeamDialogSurface>
    </Dialog>
  );
}
