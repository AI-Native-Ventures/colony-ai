import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { errorMessage, formatDate, formatZar } from "./BusinessCommon";
import {
  publishProspectAction,
  type ProspectChanges,
} from "./businessRecordMutations";
import { useDiscoveryCampaign } from "./discoveryProvider";
import { CloseOpportunityDialog } from "./LeadDialogs";
import { BusinessLogoMark } from "./BusinessLogoMark";
import {
  ArrowLeftGlyph,
  campaignFor,
  ChatGlyph,
  LeadBreadcrumb,
  LeadPill,
  RunnerMark,
} from "./LeadParts";
import { DiscoveryLeadTags } from "./DiscoveryLeadTags";
import { discoveryTagFitLabel, groupDiscoveryTags } from "./discoveryTags";
import {
  canEdit,
  displayWebsite,
  isIllustrativeEvidence,
  labelForStage,
  toneForStage,
  type LeadContext,
  type ProspectRow,
} from "./leadShared";

import "./colony3-leads.css";

const ACTIVITY_TYPES = [
  "Qualification",
  "Call note",
  "Email received",
  "Meeting",
  "Next step",
] as const;

function monthlyValue(minor: number | null | undefined): string {
  return minor === null || minor === undefined
    ? "Not set"
    : `${formatZar(minor)} / month`;
}

export function LeadDetailScreen({
  prospect,
  ...context
}: LeadContext & { prospect: ProspectRow | null }) {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lostError, setLostError] = React.useState("");
  const [activity, setActivity] = React.useState("");
  const [activityType, setActivityType] = React.useState<string>(
    ACTIVITY_TYPES[0],
  );
  const [lostOpen, setLostOpen] = React.useState(false);
  const canWrite = canEdit(context.role) && Boolean(context.currentPubkey);

  if (!prospect) {
    return (
      <main className="c3l-page" data-testid="w10-prospect-unavailable">
        <div className="c3l-wrap">
          <div className="c3l-card c3l-empty">
            <h1>This prospect is unavailable.</h1>
            <p>Return to the result list and try another profile.</p>
            <button
              className="c3l-btn c3l-btn-outline"
              onClick={() => void navigate({ to: "/leads" })}
              type="button"
            >
              All leads
            </button>
          </div>
        </div>
      </main>
    );
  }

  const record = prospect.record;
  const person = record.prospect;
  const name = person.party.displayName;
  const foundBy = campaignFor(provider, campaign, record.prospectId)?.runBy;
  const fit = person.fitScore;
  const discoveryMatches = person.discoveryTags ?? [];
  const discoveryFit = discoveryTagFitLabel(discoveryMatches);
  const discoveryTagGroups = groupDiscoveryTags(discoveryMatches);

  async function saveProspect(
    changes: ProspectChanges,
    activityRecord?: { activityKind: "note" | "contact"; content: string },
    report: (message: string) => void = setError,
  ): Promise<boolean> {
    if (!canWrite) return false;
    report("");
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
      report(errorMessage(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const currentChanges: ProspectChanges = {
    ...person,
    prospectId: record.prospectId,
    displayName: name,
    partyType: person.party.partyType as "person" | "organization",
  };
  const canQualify =
    person.qualification !== "qualified" &&
    person.stage !== "won" &&
    person.stage !== "lost";

  return (
    <main className="c3l-page" data-testid="w10-prospect-page">
      <LeadBreadcrumb name={name} />
      <div className="c3l-wrap c3l-wrap-detail">
        <div className="c3l-head">
          <div className="c3l-head-identity">
            <BusinessLogoMark
              className="c3l-mark c3l-mark-large"
              name={name}
              website={person.website}
            />
            <div className="c3l-head-text">
              <h1 className="c3l-title">{name}</h1>
              <span className="c3l-subtitle">
                {person.vertical} · {person.location ?? "Location not set"}
              </span>
            </div>
          </div>
          <button
            className="c3l-btn c3l-btn-outline c3l-head-back"
            onClick={() => void navigate({ to: "/leads" })}
            type="button"
          >
            <ArrowLeftGlyph />
            All leads
          </button>
        </div>

        <div className="c3l-columns">
          <div className="c3l-column-main">
            <section
              aria-labelledby="c3l-why-title"
              className="c3l-card c3l-panel"
            >
              <div className="c3l-panel-head">
                <h2 id="c3l-why-title">Why this business</h2>
                {foundBy || (fit !== null && fit !== undefined) ? (
                  <span className="c3l-found-by">
                    {foundBy ? (
                      <>
                        <RunnerMark runner={foundBy} size={24} />
                        Found by {foundBy.name}
                      </>
                    ) : null}
                    {foundBy && fit !== null && fit !== undefined
                      ? " · fit "
                      : fit !== null && fit !== undefined
                        ? "Fit "
                        : null}
                    {fit !== null && fit !== undefined ? fit : null}
                    {discoveryFit ? ` · ${discoveryFit}` : null}
                  </span>
                ) : null}
              </div>
              <span className="c3l-lede">
                {person.vertical} · {person.location ?? "Location not set"}
              </span>
              {person.evidence.map((item) => (
                <blockquote
                  className="c3l-evidence"
                  key={`${item.url}:${item.observedAt}`}
                >
                  <p>{item.excerpt}</p>
                  <span>
                    {isIllustrativeEvidence(item.url)
                      ? "Illustrative evidence · verify during discovery"
                      : `Source: ${item.title} · checked ${formatDate(item.observedAt)}`}
                  </span>
                </blockquote>
              ))}
              {!person.evidence.length ? (
                <p className="c3l-note">Source details need to be verified.</p>
              ) : null}
              <dl className="c3l-facts">
                <dt>Website</dt>
                <dd className="c3l-fact-strong">
                  {person.website ? (
                    <a
                      href={person.website}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {displayWebsite(person.website)}
                    </a>
                  ) : (
                    "Not set"
                  )}
                </dd>
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

            {discoveryTagGroups.length ? (
              <section
                aria-labelledby="c3l-matched-tags-title"
                className="c3l-card c3l-panel c3l-matched-tags"
              >
                <h2 id="c3l-matched-tags-title">Matched tags</h2>
                {discoveryTagGroups.map((group) => (
                  <div className="c3l-matched-tag-group" key={group.kind}>
                    <h3>{group.kind}</h3>
                    <DiscoveryLeadTags tags={group.tags} />
                  </div>
                ))}
              </section>
            ) : null}

            <section
              aria-labelledby="c3l-conversation-title"
              className="c3l-card c3l-panel"
            >
              <h2 id="c3l-conversation-title">Conversation & qualification</h2>
              {record.activities.length ? (
                <div className="c3l-activity-list">
                  {record.activities.map((item) => (
                    <article className="c3l-strip" key={item.activityId}>
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
              ) : (
                <div className="c3l-strip c3l-strip-empty">
                  <ChatGlyph />
                  No activity recorded yet. Notes from calls, emails and
                  meetings collect here.
                </div>
              )}
              <form
                className="c3l-activity-form"
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
                <div className="c3l-field">
                  <label htmlFor="c3l-activity-type">Activity</label>
                  <select
                    className="c3l-select c3l-select-field"
                    id="c3l-activity-type"
                    onChange={(event) =>
                      setActivityType(event.currentTarget.value)
                    }
                    value={activityType}
                  >
                    {ACTIVITY_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="c3l-field">
                  <label htmlFor="w10-lead-activity">Note</label>
                  <textarea
                    className="c3l-textarea c3l-textarea-note"
                    id="w10-lead-activity"
                    onChange={(event) => setActivity(event.currentTarget.value)}
                    required
                    rows={3}
                    value={activity}
                  />
                </div>
                {error ? (
                  <p className="c3l-form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  className="c3l-btn c3l-btn-primary c3l-btn-compact c3l-btn-start"
                  disabled={!canWrite || saving || !activity.trim()}
                  type="submit"
                >
                  {saving ? "Saving…" : "Record activity"}
                </button>
              </form>
            </section>
          </div>

          <aside className="c3l-column-side">
            <section
              aria-labelledby="c3l-opportunity-title"
              className="c3l-card c3l-panel"
            >
              <h2 className="c3l-panel-title-sm" id="c3l-opportunity-title">
                Opportunity
              </h2>
              <div className="c3l-opportunity-row">
                <LeadPill
                  large
                  tone={toneForStage(person.stage, person.qualification)}
                >
                  {labelForStage(person.stage, person.qualification, "New")}
                </LeadPill>
                <span className="c3l-amount">
                  {person.potentialMonthlyValueMinor === null ||
                  person.potentialMonthlyValueMinor === undefined ? (
                    "Not set"
                  ) : (
                    <>
                      {formatZar(person.potentialMonthlyValueMinor)}{" "}
                      <span>/ month</span>
                    </>
                  )}
                </span>
              </div>
              <div className="c3l-actions">
                {canQualify ? (
                  <button
                    className="c3l-btn c3l-btn-primary c3l-btn-block"
                    disabled={!canWrite || saving}
                    onClick={() =>
                      void saveProspect({
                        ...currentChanges,
                        qualification: "qualified",
                        stage: "qualified",
                      })
                    }
                    type="button"
                  >
                    Qualify lead
                  </button>
                ) : null}
                {person.stage === "lost" ? (
                  <button
                    className="c3l-btn c3l-btn-outline c3l-btn-block"
                    disabled={!canWrite || saving}
                    onClick={() =>
                      void saveProspect({
                        ...currentChanges,
                        stage: "qualified",
                        lostReason: null,
                      })
                    }
                    type="button"
                  >
                    Reopen opportunity
                  </button>
                ) : person.stage !== "won" ? (
                  <button
                    className="c3l-btn c3l-btn-outline c3l-btn-danger-text c3l-btn-block"
                    disabled={!canWrite || saving}
                    onClick={() => {
                      setLostError("");
                      setLostOpen(true);
                    }}
                    type="button"
                  >
                    Mark as lost
                  </button>
                ) : null}
              </div>
              {person.lostReason ? (
                <p className="c3l-note">{person.lostReason}</p>
              ) : null}
            </section>

            <section
              aria-labelledby="c3l-together-title"
              className="c3l-together"
            >
              <h2 id="c3l-together-title">Keep the conversation together</h2>
              <p>
                Qualification notes and decisions stay with this opportunity.
              </p>
              <a
                className="c3l-btn c3l-btn-outline c3l-btn-small"
                href={`#/channels/${context.channelId}`}
              >
                <ChatGlyph size={17} />
                Discuss in Sales
              </a>
            </section>
          </aside>
        </div>
      </div>

      <CloseOpportunityDialog
        canWrite={canWrite}
        error={lostError}
        onOpenChange={setLostOpen}
        onSubmit={({ reason, notes }) =>
          saveProspect(
            { ...currentChanges, stage: "lost", lostReason: reason },
            {
              activityKind: "note",
              content: `Lost: ${reason}${notes.trim() ? ` · ${notes.trim()}` : ""}`,
            },
            setLostError,
          )
        }
        open={lostOpen}
        saving={saving}
        subtitle={
          person.potentialMonthlyValueMinor === null ||
          person.potentialMonthlyValueMinor === undefined
            ? name
            : `${name} · ${monthlyValue(person.potentialMonthlyValueMinor)}`
        }
      />
    </main>
  );
}
