import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ArrowRight, FileText } from "lucide-react";
import { useCommunities } from "@/features/communities/useCommunities";

import type { BusinessRecords, BusinessRole } from "./businessRecordRelay";
import type { ProposalVersion } from "./businessRecordContract";
import {
  parseProposalTerms,
  publishProspectAction,
  publishProposalAcceptance,
  publishProposalVersion,
  publishServiceAction,
  type ProspectChanges,
} from "./businessRecordMutations";
import {
  BusinessTabs,
  errorMessage,
  Field,
  formatDate,
  formatZar,
  W10Button,
  W10Heading,
  W10Page,
  W10Pill,
} from "./BusinessCommon";

type ProposalContext = {
  channelId: string;
  communityId: string;
  currentPubkey: string | null;
  records: BusinessRecords;
  refresh: () => Promise<void>;
  role: BusinessRole | null;
};

type ProposalRow = BusinessRecords["proposals"][number];
type ProspectRow = BusinessRecords["prospects"][number];

function proposalRevisionRequests(
  prospect: ProspectRow | undefined,
  proposal: ProposalRow,
) {
  return (
    prospect?.record.activities.filter(
      (activity) => activity.proposalId === proposal.head.proposalId,
    ) ?? []
  );
}

function canWrite(role: BusinessRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

function canManageService(role: BusinessRole | null): boolean {
  return role === "owner" || role === "admin";
}

function proposalTitle(version: ProposalVersion): string {
  return (
    parseProposalTerms(version.terms).title ||
    version.lines[0]?.description ||
    "Service proposal"
  );
}

function proposalScope(version: ProposalVersion): string {
  const terms = parseProposalTerms(version.terms);
  return terms.scope || version.terms;
}

function proposalMonthlyFee(version: ProposalVersion): number {
  return version.lines.reduce(
    (total, line) =>
      total +
      Math.floor((line.quantityHundredths * line.unitAmountMinor) / 100),
    0,
  );
}

export function ServiceScreen(context: ProposalContext) {
  const navigate = useNavigate();
  const current =
    context.records.services.find(({ record }) => record.status === "active") ??
    null;
  const service = current?.record.service;
  const [name, setName] = React.useState(service?.name ?? "");
  const [price, setPrice] = React.useState(
    service ? String(service.monthlyFeeMinor / 100) : "",
  );
  const [posts, setPosts] = React.useState(
    service?.postsPerMonth.toString() ?? "",
  );
  const [revisions, setRevisions] = React.useState(
    service?.revisionRounds.toString() ?? "",
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const canSave =
    canManageService(context.role) && Boolean(context.currentPubkey);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await publishServiceAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current,
        serviceId: current?.record.serviceId ?? crypto.randomUUID(),
        name,
        description: service?.description ?? "",
        monthlyFeeMinor: Math.round(Number(price) * 100),
        postsPerMonth: Number(posts),
        revisionRounds: Number(revisions),
      });
      await context.refresh();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <W10Page testId="w10-service-page">
      <W10Heading title="Your service" />
      <BusinessTabs active="service" />
      <div className="w10-detail-grid w10-service-layout">
        <section className="w10-section">
          {service ? <h2>{service.name}</h2> : null}
          <form
            className="w10-form w10-service-form"
            onSubmit={(event) => void submit(event)}
          >
            <Field
              id="w10-service-name"
              label="Service name"
              onChange={setName}
              required
              value={name}
            />
            <Field
              id="w10-service-price"
              label="Monthly fee (ZAR)"
              min={0}
              onChange={setPrice}
              required
              step={0.01}
              type="number"
              value={price}
            />
            <Field
              id="w10-service-posts"
              label="Posts per month"
              max={100}
              min={1}
              onChange={setPosts}
              required
              type="number"
              value={posts}
            />
            <Field
              id="w10-service-revisions"
              label="Revision rounds"
              max={20}
              min={0}
              onChange={setRevisions}
              required
              type="number"
              value={revisions}
            />
            {error ? (
              <p className="w10-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <W10Button
              disabled={!canSave || saving}
              type="submit"
              variant="primary"
            >
              {saving ? "Saving…" : "Save service"}
            </W10Button>
          </form>
        </section>
        <section className="w10-section">
          <h2>What happens next</h2>
          <p>
            Use this as the starting scope for new proposals. Existing accepted
            agreements keep their version.
          </p>
          <W10Button
            onClick={() => void navigate({ to: "/discovery" })}
            variant="primary"
          >
            Find your first client
            <ArrowRight aria-hidden="true" />
          </W10Button>
        </section>
      </div>
    </W10Page>
  );
}

export function ProposalsScreen(context: ProposalContext) {
  const navigate = useNavigate();
  const proposals = [...context.records.proposals].sort(
    (left, right) => right.head.revision - left.head.revision,
  );
  return (
    <W10Page testId="w10-proposals-page">
      <W10Heading
        actions={
          <W10Button onClick={() => void navigate({ to: "/leads" })}>
            Review leads
          </W10Button>
        }
        title="Proposals"
      />
      <BusinessTabs active="proposals" />
      {proposals.length ? (
        <div className="w10-table-wrap">
          <table className="w10-table">
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Business</th>
                <th>Version</th>
                <th>Monthly fee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((proposal) => {
                const version = proposal.version;
                const prospect = context.records.prospects.find(
                  ({ record }) =>
                    record.prospect.party.partyId === version?.prospectPartyId,
                );
                const accepted = Boolean(
                  proposal.acceptance && proposal.receipt,
                );
                const hasRevisionRequest = proposalRevisionRequests(
                  prospect,
                  proposal,
                ).some(
                  (activity) =>
                    activity.proposalVersionEventId ===
                    proposal.head.currentVersionEventId,
                );
                const status = accepted
                  ? "Accepted"
                  : hasRevisionRequest
                    ? "Changes requested"
                    : "Draft";
                return (
                  <tr key={proposal.eventId}>
                    <td>
                      <a href={`#/sales/proposal/${proposal.head.proposalId}`}>
                        <strong>
                          {version
                            ? proposalTitle(version)
                            : "Service proposal"}
                        </strong>
                      </a>
                    </td>
                    <td>
                      {prospect?.record.prospect.party.displayName ??
                        "Prospect unavailable"}
                    </td>
                    <td>v{proposal.head.revision}</td>
                    <td>
                      {version
                        ? formatZar(proposalMonthlyFee(version))
                        : "Not set"}
                    </td>
                    <td>
                      <W10Pill tone={accepted ? "green" : "neutral"}>
                        {status}
                      </W10Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="w10-empty-state">
          <FileText aria-hidden="true" />
          <h2>Your first proposal starts with a lead</h2>
          <p>Agree the need before preparing the service.</p>
          <W10Button
            onClick={() => void navigate({ to: "/discovery" })}
            variant="primary"
          >
            Find a lead
          </W10Button>
        </div>
      )}
    </W10Page>
  );
}

export function ProposalDetailScreen({
  proposal,
  ...context
}: ProposalContext & { proposal: ProposalRow | null }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [acceptOpen, setAcceptOpen] = React.useState(false);
  const [revisionOpen, setRevisionOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const { activeCommunity } = useCommunities();

  if (!proposal?.version || !proposal.versionEventId) {
    return (
      <W10Page testId="w10-proposal-unavailable">
        <div className="w10-empty-state">
          <h1>This proposal is unavailable.</h1>
          <p>Return to Proposals and try another version.</p>
          <a
            className="w10-button w10-button-secondary"
            href="#/sales/proposals"
          >
            All proposals
          </a>
        </div>
      </W10Page>
    );
  }

  const version = proposal.version;
  const terms = parseProposalTerms(version.terms);
  const prospect = context.records.prospects.find(
    ({ record }) => record.prospect.party.partyId === version.prospectPartyId,
  );
  const revisionRequests = proposalRevisionRequests(prospect, proposal);
  const accepted = Boolean(proposal.acceptance && proposal.receipt);
  const revisionRequested = revisionRequests.some(
    (activity) =>
      activity.proposalVersionEventId === proposal.head.currentVersionEventId,
  );
  const status = accepted
    ? "accepted"
    : revisionRequested
      ? "changes requested"
      : "draft";
  const acceptedBy = proposal.acceptance?.evidence?.acceptedByName;
  const amount = proposalMonthlyFee(version);
  const serviceStart = terms.serviceStart || "Not set";

  async function acceptProposal(input: {
    acceptedByName: string;
    acceptedAt: number;
    evidenceReference: string;
    exactTermsConfirmed: boolean;
  }) {
    if (!proposal || !context.currentPubkey) {
      setError("Identity is unavailable. Retry when the connection is ready.");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      await publishProposalAcceptance({
        channelId: context.channelId,
        communityId: context.communityId,
        proposal: { head: proposal.head },
        ...input,
      });
      await context.refresh();
      setAcceptOpen(false);
      return true;
    } catch (submitError) {
      setError(errorMessage(submitError));
      try {
        await context.refresh();
      } catch {
        // The retry form stays open so the same version can be submitted again.
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <W10Page testId="w10-proposal-page">
      <W10Heading
        title="Service proposal"
        actions={
          <a
            className="w10-button w10-button-secondary"
            href="#/sales/proposals"
          >
            All proposals
          </a>
        }
      />
      <div className="w10-detail-grid w10-proposal-layout">
        <article className="w10-document">
          <header>
            <strong>{activeCommunity?.name ?? ""}</strong>
            <W10Pill tone={accepted ? "green" : "neutral"}>
              v{proposal.head.revision} · {status}
            </W10Pill>
          </header>
          <small>
            PREPARED FOR{" "}
            {prospect?.record.prospect.party.displayName.toLocaleUpperCase() ??
              "PROSPECT"}
          </small>
          <h2>
            {terms.title || version.lines[0]?.description || "Service proposal"}
          </h2>
          <p>{proposalScope(version)}</p>
          <div className="w10-document-metrics">
            <Metric label="Monthly fee" value={formatZar(amount)} />
            <Metric
              label="Posts"
              value={
                terms.postsPerMonth ? terms.postsPerMonth.toString() : "Not set"
              }
            />
            <Metric
              label="Revisions"
              value={
                terms.revisionRounds
                  ? terms.revisionRounds.toString()
                  : "Not set"
              }
            />
            <Metric label="Starts" value={serviceStart} />
          </div>
          <p className="w10-note">
            This mockup records agreed service terms. No agreement is sent or
            signed externally.
          </p>
        </article>
        <aside className="w10-proposal-side">
          <section className="w10-section">
            <h2>Review & handoff</h2>
            <div className="w10-stacked-actions">
              {!accepted ? (
                <>
                  <W10Button
                    disabled={!canWrite(context.role)}
                    onClick={() => setEditOpen(true)}
                    variant="secondary"
                  >
                    Edit proposal
                  </W10Button>
                  <W10Button
                    disabled={!canWrite(context.role)}
                    onClick={() => {
                      setError("");
                      setAcceptOpen(true);
                    }}
                    variant="primary"
                  >
                    Record client acceptance
                  </W10Button>
                </>
              ) : (
                <p>
                  Accepted by {acceptedBy} ·{" "}
                  {formatDate(proposal.acceptance?.evidence?.acceptedAt)}
                </p>
              )}
              <W10Button
                disabled={!canWrite(context.role) || !context.currentPubkey}
                onClick={() => {
                  setError("");
                  setRevisionOpen(true);
                }}
                testId="w10-request-revision"
                variant="secondary"
              >
                Request a revision
              </W10Button>
            </div>
            {error ? (
              <p className="w10-form-error" role="alert">
                {error}
              </p>
            ) : null}
            {proposal.receipt ? (
              <p className="w10-note" data-testid="w10-conversion-receipt">
                Client, first work and draft invoice are linked.
              </p>
            ) : null}
          </section>
          <section className="w10-section">
            <h2>Version history</h2>
            {proposal.versions.some(
              ({ record: prior }) => prior.revision < version.revision,
            ) || revisionRequests.length ? (
              <div className="w10-version-history">
                {proposal.versions
                  .filter(
                    ({ record: prior }) => prior.revision < version.revision,
                  )
                  .map(({ eventId, record: prior }) => {
                    const priorTerms = parseProposalTerms(prior.terms);
                    return (
                      <article key={eventId}>
                        <div>
                          <strong>Version {prior.revision}</strong>
                          <small>{priorTerms.scope || prior.terms}</small>
                        </div>
                      </article>
                    );
                  })}
                {revisionRequests.map((activity) => {
                  const requestedVersion = proposal.versions.find(
                    ({ eventId }) =>
                      eventId === activity.proposalVersionEventId,
                  )?.record.revision;
                  return (
                    <article key={activity.activityId}>
                      <div>
                        <strong>Revision requested</strong>
                        <small>
                          {requestedVersion
                            ? `Version ${requestedVersion}`
                            : "Proposal version"}{" "}
                          · {formatDate(activity.createdAt)}
                        </small>
                        <small>{activity.content}</small>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p>First service proposal.</p>
            )}
          </section>
          <section className="w10-section">
            <h2>Acceptance evidence</h2>
            {proposal.acceptance ? (
              <>
                <p>
                  {proposal.acceptance.evidence?.evidenceReference ??
                    "Acceptance recorded."}
                </p>
                <p className="w10-note">
                  Recorded for proposal version{" "}
                  {proposal.acceptance.proposalVersionEventId ===
                  proposal.head.currentVersionEventId
                    ? proposal.head.revision
                    : "previous"}
                  .
                </p>
              </>
            ) : (
              <p>No acceptance recorded.</p>
            )}
          </section>
        </aside>
      </div>
      <ProposalVersionDialog
        context={context}
        onOpenChange={setEditOpen}
        open={editOpen}
        proposal={proposal}
        prospect={prospect?.record ?? null}
      />
      <AcceptanceDialog
        acceptedName={prospect?.record.prospect.contactName ?? ""}
        onOpenChange={setAcceptOpen}
        onSubmit={acceptProposal}
        open={acceptOpen}
        saving={saving}
        proposalVersion={proposal.head.revision}
      />
      {prospect ? (
        <ProposalRevisionDialog
          context={context}
          onOpenChange={setRevisionOpen}
          open={revisionOpen}
          proposal={proposal}
          prospect={prospect}
        />
      ) : null}
    </W10Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="w10-metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function ProposalVersionDialog({
  context,
  proposal,
  prospect,
  open,
  onOpenChange,
}: {
  context: ProposalContext;
  proposal: ProposalRow;
  prospect: BusinessRecords["prospects"][number]["record"] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const version = proposal.version;
  const parsed = version ? parseProposalTerms(version.terms) : null;
  const [title, setTitle] = React.useState(parsed?.title ?? "");
  const [scope, setScope] = React.useState(parsed?.scope ?? "");
  const [amount, setAmount] = React.useState(
    version ? String(proposalMonthlyFee(version) / 100) : "",
  );
  const [posts, setPosts] = React.useState(
    parsed?.postsPerMonth.toString() ?? "",
  );
  const [revisions, setRevisions] = React.useState(
    parsed?.revisionRounds.toString() ?? "",
  );
  const [start, setStart] = React.useState(parsed?.serviceStart ?? "");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !version) return;
    const current = parseProposalTerms(version.terms);
    setTitle(current.title);
    setScope(current.scope);
    setAmount(String(proposalMonthlyFee(version) / 100));
    setPosts(current.postsPerMonth.toString());
    setRevisions(current.revisionRounds.toString());
    setStart(current.serviceStart);
    setError("");
  }, [open, version]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!version || !prospect || !context.currentPubkey) {
      setError("The current proposal or signer is unavailable.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await publishProposalVersion({
        channelId: context.channelId,
        communityId: context.communityId,
        proposalId: proposal.head.proposalId,
        prospect,
        current: {
          eventId: proposal.eventId,
          head: {
            revision: proposal.head.revision,
            currentVersionEventId: proposal.head.currentVersionEventId,
          },
        },
        acceptorPubkey: context.currentPubkey,
        terms: {
          title: title.trim(),
          scope: scope.trim(),
          postsPerMonth: Number(posts),
          revisionRounds: Number(revisions),
          serviceStart: start,
        },
        monthlyFeeMinor: Math.round(Number(amount) * 100),
        serviceId: version.lines[0]?.serviceId ?? null,
      });
      await context.refresh();
      onOpenChange(false);
      await navigate({
        to: "/sales/proposal/$proposalId",
        params: { proposalId: proposal.head.proposalId },
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
      try {
        await context.refresh();
      } catch {
        // Keep the revision form intact so the user can retry.
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w10-dialog-content"
        data-testid="w10-proposal-edit-dialog"
      >
        <DialogHeader>
          <DialogTitle>Edit proposal</DialogTitle>
          <DialogDescription className="sr-only">
            Save a new immutable proposal version.
          </DialogDescription>
        </DialogHeader>
        <form className="w10-form" onSubmit={(event) => void submit(event)}>
          <Field
            id="w10-edit-title"
            label="Title"
            onChange={setTitle}
            required
            value={title}
          />
          <Field
            id="w10-edit-scope"
            label="Scope & exclusions"
            onChange={setScope}
            required
            rows={5}
            value={scope}
          />
          <Field
            id="w10-edit-amount"
            label="Monthly fee (ZAR)"
            min={1}
            onChange={setAmount}
            required
            step={0.01}
            type="number"
            value={amount}
          />
          <div className="w10-field-grid">
            <Field
              id="w10-edit-posts"
              label="Posts per month"
              min={1}
              onChange={setPosts}
              required
              type="number"
              value={posts}
            />
            <Field
              id="w10-edit-revisions"
              label="Revision rounds"
              min={1}
              onChange={setRevisions}
              required
              type="number"
              value={revisions}
            />
          </div>
          <Field
            id="w10-edit-start"
            label="Service start"
            onChange={setStart}
            required
            type="date"
            value={start}
          />
          {error ? (
            <p className="w10-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="w10-dialog-actions">
            <W10Button onClick={() => onOpenChange(false)}>Cancel</W10Button>
            <W10Button disabled={saving} type="submit" variant="primary">
              {saving ? "Saving…" : "Save proposal"}
            </W10Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProposalRevisionDialog({
  context,
  onOpenChange,
  open,
  proposal,
  prospect,
}: {
  context: ProposalContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  proposal: ProposalRow;
  prospect: ProspectRow;
}) {
  const activityId = React.useRef<string | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [content, setContent] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      activityId.current ??= crypto.randomUUID();
      setError("");
    }
  }, [open]);

  React.useEffect(() => {
    const pendingId = activityId.current;
    if (!pendingId) return;
    const saved = context.records.prospects.some(({ record }) =>
      record.activities.some((activity) => activity.activityId === pendingId),
    );
    if (saved) {
      activityId.current = null;
      setContent("");
      setError("");
      onOpenChange(false);
    }
  }, [context.records.prospects, onOpenChange]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context.currentPubkey || !canWrite(context.role)) {
      setError("Identity or permission is unavailable. Retry when ready.");
      return;
    }
    const pendingId = activityId.current ?? crypto.randomUUID();
    activityId.current = pendingId;
    if (
      prospect.record.activities.some(
        (activity) => activity.activityId === pendingId,
      )
    ) {
      activityId.current = null;
      setContent("");
      onOpenChange(false);
      return;
    }
    const person = prospect.record.prospect;
    const changes: ProspectChanges = {
      ...person,
      prospectId: prospect.record.prospectId,
      displayName: person.party.displayName,
      partyType: person.party.partyType as "person" | "organization",
    };
    setSaving(true);
    setError("");
    try {
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: prospect,
        changes,
        activity: {
          activityId: pendingId,
          activityKind: "note",
          content: content.trim(),
          proposalId: proposal.head.proposalId,
          proposalVersionEventId: proposal.head.currentVersionEventId,
        },
      });
      await context.refresh();
    } catch (saveError) {
      setError(errorMessage(saveError));
      try {
        await context.refresh();
      } catch {
        // Keep the text and activity id so the same request can be retried.
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w10-dialog-content"
        data-testid="w10-proposal-revision-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            Request a revision
          </DialogTitle>
          <DialogDescription className="sr-only">
            Record the changes requested for this proposal version.
          </DialogDescription>
        </DialogHeader>
        <form className="w10-form" onSubmit={(event) => void submit(event)}>
          <Field
            id="w10-proposal-revision-feedback"
            label="What needs to change?"
            onChange={setContent}
            required
            rows={4}
            value={content}
          />
          {error ? (
            <p className="w10-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="w10-dialog-actions">
            <W10Button disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </W10Button>
            <W10Button disabled={saving} type="submit" variant="primary">
              {saving ? "Saving…" : "Save feedback"}
            </W10Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AcceptanceDialog({
  acceptedName,
  onOpenChange,
  onSubmit,
  open,
  saving,
  proposalVersion,
}: {
  acceptedName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    acceptedByName: string;
    acceptedAt: number;
    evidenceReference: string;
    exactTermsConfirmed: boolean;
  }) => Promise<boolean>;
  open: boolean;
  saving: boolean;
  proposalVersion: number;
}) {
  const [name, setName] = React.useState(acceptedName);
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setName(acceptedName);
    setDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setConfirmed(false);
    setError("");
  }, [acceptedName, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) {
      setError("Confirm that the current version was accepted.");
      return;
    }
    const acceptedAt = Math.floor(
      new Date(`${date}T12:00:00`).getTime() / 1_000,
    );
    const saved = await onSubmit({
      acceptedByName: name,
      acceptedAt,
      evidenceReference: reference,
      exactTermsConfirmed: confirmed,
    });
    if (saved) onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w10-dialog-content"
        data-testid="w10-acceptance-dialog"
      >
        <DialogHeader>
          <DialogTitle>Record acceptance · v{proposalVersion}</DialogTitle>
          <DialogDescription className="sr-only">
            Record acceptance for this exact proposal version.
          </DialogDescription>
        </DialogHeader>
        <form className="w10-form" onSubmit={(event) => void submit(event)}>
          <Field
            id="w10-accepted-name"
            label="Accepted by"
            onChange={setName}
            required
            value={name}
          />
          <Field
            id="w10-accepted-date"
            label="Date"
            onChange={setDate}
            required
            type="date"
            value={date}
          />
          <Field
            id="w10-acceptance-reference"
            label="Evidence or reference"
            onChange={setReference}
            placeholder="Email, meeting record or signed document reference"
            required
            rows={3}
            value={reference}
          />
          <label className="w10-checkbox-row">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              I have verified acceptance of this exact scope, price and version.
            </span>
          </label>
          {error ? (
            <p className="w10-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="w10-dialog-actions">
            <W10Button onClick={() => onOpenChange(false)}>Cancel</W10Button>
            <W10Button disabled={saving} type="submit" variant="primary">
              {saving ? "Saving…" : "Record acceptance"}
            </W10Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
