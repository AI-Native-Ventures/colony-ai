import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ArrowRight, Search } from "lucide-react";

import type { BusinessRecords, BusinessRole } from "./businessRecordRelay";
import type { ProspectStage } from "./businessRecordContract";
import {
  publishProspectAction,
  publishProposalVersion,
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

type LeadContext = {
  channelId: string;
  communityId: string;
  currentPubkey: string | null;
  records: BusinessRecords;
  refresh: () => Promise<void>;
  role: BusinessRole | null;
};

type ProspectRow = BusinessRecords["prospects"][number];

const STAGES: Array<{ value: ProspectStage; label: string }> = [
  { value: "qualified", label: "Qualified" },
  { value: "in_conversation", label: "In conversation" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function canEdit(role: BusinessRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

function labelForStage(
  stage: ProspectStage,
  qualification: string,
  unreviewedLabel = "Candidate",
): string {
  if (qualification === "unreviewed") return unreviewedLabel;
  return STAGES.find((item) => item.value === stage)?.label ?? stage;
}

function createChanges(
  name: string,
  industry: string,
  location: string,
): ProspectChanges {
  const prospectId = crypto.randomUUID();
  return {
    prospectId,
    displayName: name,
    partyType: "organization",
    industry,
    vertical: industry,
    fitScore: null,
    potentialMonthlyValueMinor: null,
    website: null,
    contactName: null,
    location: location || null,
    email: null,
    phone: null,
    evidence: [],
    lastVerifiedAt: null,
    qualification: "unreviewed",
    saved: false,
    stage: "qualified",
    lostReason: null,
  };
}

export function LeadsScreen(context: LeadContext) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [stage, setStage] = React.useState("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [location, setLocation] = React.useState("");
  const canWrite = canEdit(context.role);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const prospects = context.records.prospects
    .filter(({ record }) => record.status === "active")
    .filter(({ record }) => {
      const prospect = record.prospect;
      const matchesQuery =
        !normalizedQuery ||
        [
          prospect.party.displayName,
          prospect.contactName ?? "",
          prospect.industry,
          prospect.vertical,
          prospect.location ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      const matchesStage =
        stage === "all" ||
        (stage === "new"
          ? prospect.qualification === "unreviewed"
          : prospect.stage === stage);
      return matchesQuery && matchesStage;
    });

  async function createLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const duplicate = context.records.prospects.find(
      ({ record }) =>
        record.status === "active" &&
        record.prospect.party.displayName.trim().toLocaleLowerCase() ===
          name.trim().toLocaleLowerCase(),
    );
    if (duplicate) {
      setError(
        "This business already exists in Leads. Open the existing record.",
      );
      return;
    }
    if (!context.currentPubkey) {
      setError("Identity is unavailable. Retry when the connection is ready.");
      return;
    }
    setSaving(true);
    try {
      const changes = createChanges(name, industry, location);
      changes.contactName = contact || null;
      changes.email = email || null;
      changes.website = website || null;
      const prospectId = changes.prospectId;
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: null,
        changes,
      });
      await context.refresh();
      setDialogOpen(false);
      await navigate({ to: "/sales/lead/$prospectId", params: { prospectId } });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <W10Page testId="w10-leads-page">
      <W10Heading
        actions={
          <>
            {canWrite ? (
              <W10Button onClick={() => setDialogOpen(true)} variant="quiet">
                Add lead
              </W10Button>
            ) : null}
            <W10Button
              onClick={() => void navigate({ to: "/discovery" })}
              variant="primary"
            >
              Find prospects
              <ArrowRight aria-hidden="true" />
            </W10Button>
          </>
        }
        title="Leads"
      />
      <BusinessTabs active="leads" />
      <div className="w10-filterbar">
        <label className="w10-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search leads</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search leads…"
            value={query}
          />
        </label>
        <label className="sr-only" htmlFor="w10-lead-stage-filter">
          Lead stage
        </label>
        <select
          id="w10-lead-stage-filter"
          onChange={(event) => setStage(event.currentTarget.value)}
          value={stage}
        >
          <option value="all">All stages</option>
          <option value="new">New</option>
          {STAGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {prospects.length ? (
        <div className="w10-table-wrap">
          <table className="w10-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Contact</th>
                <th>Stage</th>
                <th>Service / month</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map(({ record, eventId }) => {
                const prospect = record.prospect;
                return (
                  <tr key={eventId}>
                    <td>
                      <a href={`#/sales/lead/${record.prospectId}`}>
                        <strong>{prospect.party.displayName}</strong>
                        <small className="w10-record-caption">
                          {prospect.vertical} ·{" "}
                          {prospect.location ?? "Location not set"}
                        </small>
                      </a>
                    </td>
                    <td>{prospect.contactName ?? "Not set"}</td>
                    <td>
                      <W10Pill
                        tone={prospect.stage === "won" ? "green" : "neutral"}
                      >
                        {labelForStage(
                          prospect.stage,
                          prospect.qualification,
                          "New",
                        )}
                      </W10Pill>
                    </td>
                    <td>{formatZar(prospect.potentialMonthlyValueMinor)}</td>
                    <td>
                      <a
                        className="w10-text-link"
                        href={`#/sales/lead/${record.prospectId}`}
                      >
                        Review lead
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="w10-empty-state">
          <h2>
            {context.records.prospects.length
              ? "No leads match these filters."
              : "No leads yet"}
          </h2>
          <p>
            {context.records.prospects.length
              ? "Try a different name, location or stage."
              : "Find a business that could benefit from your service, or add a lead yourself."}
          </p>
          {context.records.prospects.length ? (
            <W10Button
              onClick={() => {
                setQuery("");
                setStage("all");
              }}
            >
              Clear filters
            </W10Button>
          ) : (
            <W10Button
              onClick={() => void navigate({ to: "/discovery" })}
              variant="primary"
            >
              Explore Discovery
            </W10Button>
          )}
        </div>
      )}

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent
          className="w10-dialog-content"
          data-testid="w10-add-lead-dialog"
        >
          <DialogHeader>
            <DialogTitle>Add lead</DialogTitle>
            <DialogDescription className="sr-only">
              Add a business to Leads.
            </DialogDescription>
          </DialogHeader>
          <form
            className="w10-form"
            onSubmit={(event) => void createLead(event)}
          >
            <Field
              id="w10-lead-name"
              label="Business name"
              onChange={setName}
              required
              value={name}
            />
            <Field
              id="w10-lead-contact"
              label="Contact name"
              onChange={setContact}
              required
              value={contact}
            />
            <Field
              id="w10-lead-email"
              label="Email"
              onChange={setEmail}
              required
              type="email"
              value={email}
            />
            <Field
              id="w10-lead-website"
              label="Website"
              onChange={setWebsite}
              type="url"
              value={website}
            />
            <Field
              id="w10-lead-industry"
              label="Industry"
              onChange={setIndustry}
              required
              value={industry}
            />
            <Field
              id="w10-lead-location"
              label="Location"
              onChange={setLocation}
              required
              value={location}
            />
            {error ? (
              <p className="w10-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="w10-dialog-actions">
              <W10Button
                onClick={() => setDialogOpen(false)}
                variant="secondary"
              >
                Cancel
              </W10Button>
              <W10Button
                disabled={saving || !canWrite}
                type="submit"
                variant="primary"
              >
                {saving ? "Saving…" : "Add lead"}
              </W10Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </W10Page>
  );
}

export function PipelineScreen(context: LeadContext) {
  const navigate = useNavigate();
  const prospects = context.records.prospects.filter(
    ({ record }) =>
      record.status === "active" &&
      record.prospect.qualification === "qualified",
  );
  const openProspects = prospects.filter(
    ({ record }) => !["won", "lost"].includes(record.prospect.stage),
  );
  const potentialValue = openProspects.reduce(
    (total, { record }) =>
      total + (record.prospect.potentialMonthlyValueMinor ?? 0),
    0,
  );

  return (
    <W10Page wide testId="w10-pipeline-page">
      <W10Heading
        actions={
          <W10Button
            onClick={() => void navigate({ to: "/discovery" })}
            variant="primary"
          >
            Find prospects
          </W10Button>
        }
        title="Pipeline"
      />
      <BusinessTabs active="pipeline" />
      <section aria-label="Pipeline summary" className="w10-metrics">
        <Metric
          label="Open opportunities"
          value={openProspects.length.toString()}
        />
        <Metric
          label="Proposals"
          value={context.records.proposals
            .filter(({ acceptance }) => !acceptance)
            .length.toString()}
        />
        <Metric
          label="New clients"
          value={prospects
            .filter(({ record }) => record.prospect.stage === "won")
            .length.toString()}
        />
        <Metric
          label="Monthly opportunity"
          value={formatZar(potentialValue)}
          note="Potential service value"
        />
      </section>
      <div className="w10-pipeline-board">
        {STAGES.map((item) => {
          const cards = prospects.filter(
            ({ record }) => record.prospect.stage === item.value,
          );
          return (
            <section
              aria-label={item.label}
              className="w10-pipeline-column"
              key={item.value}
            >
              <h2>
                {item.label}
                <small>{cards.length}</small>
              </h2>
              {cards.map((row) => {
                const prospect = row.record.prospect;
                return (
                  <a
                    className="w10-opportunity-card"
                    href={`#/sales/lead/${row.record.prospectId}`}
                    key={row.eventId}
                  >
                    <strong>{prospect.party.displayName}</strong>
                    <p className="w10-opportunity-value">
                      {formatZar(prospect.potentialMonthlyValueMinor)}
                    </p>
                    <small>{prospect.contactName ?? ""}</small>
                  </a>
                );
              })}
            </section>
          );
        })}
      </div>
    </W10Page>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="w10-metric">
      <small>{label}</small>
      <strong>{value}</strong>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

export function LeadDetailScreen({
  prospect,
  ...context
}: LeadContext & { prospect: ProspectRow | null }) {
  const navigate = useNavigate();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [activity, setActivity] = React.useState("");
  const [activityType, setActivityType] = React.useState("Qualification");
  const [proposalOpen, setProposalOpen] = React.useState(false);
  const [lostOpen, setLostOpen] = React.useState(false);
  const [lostReason, setLostReason] = React.useState("Not a fit");
  const [lostNotes, setLostNotes] = React.useState("");
  const canWrite = canEdit(context.role) && Boolean(context.currentPubkey);

  if (!prospect) {
    return (
      <W10Page testId="w10-prospect-unavailable">
        <div className="w10-empty-state">
          <h1>This prospect is unavailable.</h1>
          <p>Return to the result list and try another profile.</p>
          <W10Button onClick={() => void navigate({ to: "/leads" })}>
            All leads
          </W10Button>
        </div>
      </W10Page>
    );
  }

  const record = prospect.record;
  const person = record.prospect;
  const proposals = context.records.proposals.filter(
    ({ version }) => version?.prospectPartyId === person.party.partyId,
  );
  const currentProposal = proposals.sort(
    (left, right) => right.head.revision - left.head.revision,
  )[0];

  async function saveProspect(
    changes: ProspectChanges,
    activityRecord?: { activityKind: "note" | "contact"; content: string },
  ): Promise<boolean> {
    if (!canWrite) return false;
    setError("");
    setSaving(true);
    try {
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: prospect,
        changes,
        activity: activityRecord,
      });
      await context.refresh();
      setActivity("");
      return true;
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const currentChanges: ProspectChanges = {
    ...person,
    prospectId: record.prospectId,
    displayName: person.party.displayName,
    partyType: person.party.partyType as "person" | "organization",
  };

  return (
    <W10Page testId="w10-prospect-page">
      <W10Heading
        actions={
          <W10Button onClick={() => void navigate({ to: "/leads" })}>
            All leads
          </W10Button>
        }
        title={person.party.displayName}
      />
      <div className="w10-detail-grid">
        <div className="w10-detail-main">
          <section className="w10-section">
            <h2>Why this business</h2>
            <p>
              {person.vertical} · {person.location ?? "Location not set"}
            </p>
            {person.evidence.map((item) => (
              <React.Fragment key={`${item.url}:${item.observedAt}`}>
                <p className="w10-prose">{item.excerpt}</p>
                <p className="w10-evidence-source">
                  Illustrative evidence · verify during discovery
                </p>
              </React.Fragment>
            ))}
            {!person.evidence.length ? (
              <p className="w10-note">Source details need to be verified.</p>
            ) : null}
            <dl className="w10-facts">
              <dt>Website</dt>
              <dd>{person.website ?? "Not set"}</dd>
              <dt>Contact</dt>
              <dd>
                {person.contactName ?? "Not set"}
                {person.email ? ` · ${person.email}` : ""}
              </dd>
              <dt>Source</dt>
              <dd>
                {person.evidence.map((item) => item.title).join(", ") ||
                  "Not set"}
              </dd>
            </dl>
          </section>
          <section className="w10-section">
            <h2>Conversation & qualification</h2>
            <div className="w10-activity-list">
              {record.activities.map((item) => (
                <article key={item.activityId}>
                  <p>{item.content}</p>
                  <small>
                    {item.activityKind === "contact"
                      ? "Contact"
                      : "Qualification"}{" "}
                    · {formatDate(item.createdAt)}
                  </small>
                </article>
              ))}
            </div>
            <form
              className="w10-form w10-activity-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProspect(currentChanges, {
                  activityKind: [
                    "Call note",
                    "Email received",
                    "Meeting",
                  ].includes(activityType)
                    ? "contact"
                    : "note",
                  content: `${activityType}: ${activity.trim()}`,
                });
              }}
            >
              <label className="w10-field">
                <span>Activity</span>
                <select
                  onChange={(event) =>
                    setActivityType(event.currentTarget.value)
                  }
                  value={activityType}
                >
                  {[
                    "Qualification",
                    "Call note",
                    "Email received",
                    "Meeting",
                    "Next step",
                  ].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                id="w10-lead-activity"
                label="Note"
                onChange={setActivity}
                required
                rows={3}
                value={activity}
              />
              {error ? (
                <p className="w10-form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <W10Button
                disabled={!canWrite || saving || !activity.trim()}
                type="submit"
                variant="secondary"
              >
                {saving ? "Saving…" : "Record activity"}
              </W10Button>
            </form>
          </section>
        </div>
        <aside className="w10-detail-side">
          <section className="w10-section">
            <h2>Opportunity</h2>
            <W10Pill
              tone={
                person.stage === "won"
                  ? "green"
                  : person.stage === "lost"
                    ? "red"
                    : "neutral"
              }
            >
              {labelForStage(person.stage, person.qualification, "New")}
            </W10Pill>
            <p className="w10-opportunity-total">
              {formatZar(person.potentialMonthlyValueMinor)} / month
            </p>
            <div className="w10-stacked-actions">
              {person.qualification !== "qualified" &&
              person.stage !== "won" &&
              person.stage !== "lost" ? (
                <W10Button
                  disabled={!canWrite || saving}
                  onClick={() =>
                    void saveProspect({
                      ...currentChanges,
                      qualification: "qualified",
                      stage: "qualified",
                    })
                  }
                  variant="primary"
                >
                  Qualify lead
                </W10Button>
              ) : null}
              <W10Button disabled variant="secondary">
                Prepare outreach
              </W10Button>
              {currentProposal ? (
                <a
                  className="w10-button w10-button-primary"
                  href={`#/sales/proposal/${currentProposal.head.proposalId}`}
                >
                  Open proposal · v{currentProposal.head.revision}
                </a>
              ) : (
                <W10Button
                  disabled={!canWrite}
                  onClick={() => setProposalOpen(true)}
                  variant="primary"
                >
                  Prepare proposal
                </W10Button>
              )}
              {person.stage === "lost" ? (
                <W10Button
                  disabled={!canWrite || saving}
                  onClick={() =>
                    void saveProspect({
                      ...currentChanges,
                      stage: "qualified",
                      lostReason: null,
                    })
                  }
                  variant="quiet"
                >
                  Reopen opportunity
                </W10Button>
              ) : person.stage !== "won" ? (
                <W10Button
                  disabled={!canWrite || saving}
                  onClick={() => setLostOpen(true)}
                  variant="quiet"
                >
                  Mark as lost
                </W10Button>
              ) : null}
            </div>
            {person.lostReason ? (
              <p className="w10-note">{person.lostReason}</p>
            ) : null}
          </section>
          <section className="w10-section">
            <h2>Keep the conversation together</h2>
            <p>
              Qualification notes and proposal decisions stay with this
              opportunity.
            </p>
            <a
              className="w10-button w10-button-secondary"
              href={`#/channels/${context.channelId}`}
            >
              Discuss in Sales
            </a>
          </section>
        </aside>
      </div>

      <ProposalCreateDialog
        context={context}
        onOpenChange={setProposalOpen}
        open={proposalOpen}
        prospect={prospect}
      />
      <Dialog onOpenChange={setLostOpen} open={lostOpen}>
        <DialogContent
          className="w10-dialog-content"
          data-testid="w10-close-opportunity-dialog"
        >
          <DialogHeader>
            <DialogTitle>Close this opportunity</DialogTitle>
            <DialogDescription className="sr-only">
              Record why this opportunity is being closed.
            </DialogDescription>
          </DialogHeader>
          <form
            className="w10-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProspect(
                { ...currentChanges, stage: "lost", lostReason },
                {
                  activityKind: "note",
                  content: `Lost: ${lostReason}${lostNotes.trim() ? ` · ${lostNotes.trim()}` : ""}`,
                },
              ).then((saved) => {
                if (saved) setLostOpen(false);
              });
            }}
          >
            <label className="w10-field">
              <span>Reason</span>
              <select
                onChange={(event) => setLostReason(event.currentTarget.value)}
                value={lostReason}
              >
                {[
                  "Not a fit",
                  "Budget",
                  "Timing",
                  "Chose another provider",
                ].map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <Field
              id="w10-lost-notes"
              label="Notes"
              onChange={setLostNotes}
              rows={3}
              value={lostNotes}
            />
            {error ? (
              <p className="w10-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="w10-dialog-actions">
              <W10Button disabled={saving} onClick={() => setLostOpen(false)}>
                Cancel
              </W10Button>
              <W10Button
                disabled={!canWrite || saving}
                type="submit"
                variant="primary"
              >
                Mark as lost
              </W10Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </W10Page>
  );
}

function ProposalCreateDialog({
  context,
  prospect,
  open,
  onOpenChange,
}: {
  context: LeadContext;
  prospect: ProspectRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const service = context.records.services.find(
    ({ record }) => record.status === "active",
  )?.record.service;
  const [title, setTitle] = React.useState(service?.name ?? "");
  const [scope, setScope] = React.useState(service?.description ?? "");
  const [amount, setAmount] = React.useState(
    service ? String(service.monthlyFeeMinor / 100) : "",
  );
  const [posts, setPosts] = React.useState(
    service?.postsPerMonth.toString() ?? "8",
  );
  const [revisions, setRevisions] = React.useState(
    service?.revisionRounds.toString() ?? "2",
  );
  const [start, setStart] = React.useState("2026-10-01");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context.currentPubkey) {
      setError("Identity is unavailable. Retry when the connection is ready.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const proposalId = crypto.randomUUID();
      await publishProposalVersion({
        channelId: context.channelId,
        communityId: context.communityId,
        proposalId,
        prospect: prospect.record,
        current: null,
        acceptorPubkey: context.currentPubkey,
        terms: {
          title: title.trim(),
          scope: scope.trim(),
          postsPerMonth: Number(posts),
          revisionRounds: Number(revisions),
          serviceStart: start,
        },
        monthlyFeeMinor: Math.round(Number(amount) * 100),
        serviceId: service?.serviceId ?? null,
      });
      await context.refresh();
      onOpenChange(false);
      await navigate({
        to: "/sales/proposal/$proposalId",
        params: { proposalId },
      });
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w10-dialog-content"
        data-testid="w10-proposal-form"
      >
        <DialogHeader>
          <DialogTitle>Prepare proposal</DialogTitle>
          <DialogDescription className="sr-only">
            Prepare a service proposal for{" "}
            {prospect.record.prospect.party.displayName}.
          </DialogDescription>
        </DialogHeader>
        <form className="w10-form" onSubmit={(event) => void submit(event)}>
          <Field
            id="w10-proposal-title"
            label="Title"
            onChange={setTitle}
            required
            value={title}
          />
          <Field
            id="w10-proposal-scope"
            label="Scope & exclusions"
            onChange={setScope}
            required
            rows={5}
            value={scope}
          />
          <Field
            id="w10-proposal-amount"
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
              id="w10-proposal-posts"
              label="Posts per month"
              min={1}
              onChange={setPosts}
              required
              type="number"
              value={posts}
            />
            <Field
              id="w10-proposal-revisions"
              label="Revision rounds"
              min={1}
              onChange={setRevisions}
              required
              type="number"
              value={revisions}
            />
          </div>
          <Field
            id="w10-proposal-start"
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
