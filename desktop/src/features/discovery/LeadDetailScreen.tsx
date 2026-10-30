import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { errorMessage, formatDate, formatZar } from "./BusinessCommon";
import {
  publishProspectAction,
  type ProspectChanges,
} from "./businessRecordMutations";
import { useDiscoveryCampaign } from "./discoveryProvider";
import {
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
  useWhatsAppLeadData,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import {
  maskWhatsAppNumber,
  whatsappLeadStatusLabel,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";
import { useWhatsAppThreadQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
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

function whatsAppTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function whatsAppDay(value: string): string {
  const date = new Date(value);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const messageDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (messageDay === today) return "today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
  return messageDay === yesterdayDay
    ? "yesterday"
    : new Intl.DateTimeFormat("en-ZA", {
        timeZone: "Africa/Johannesburg",
        day: "numeric",
        month: "short",
      }).format(date);
}

function replyWindowRemaining(closesAt: string | null | undefined): string {
  if (!closesAt) return "";
  const remainingMs = Date.parse(closesAt) - Date.now();
  if (remainingMs <= 0) return "Closed";
  return `${Math.ceil(remainingMs / 3_600_000)} h left`;
}

export function LeadDetailScreen({
  prospect,
  ...context
}: LeadContext & { prospect: ProspectRow | null }) {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const { statusQuery, contactsQuery, inBatchLeadIds } = useWhatsAppLeadData();
  const whatsappContact = prospect
    ? findWhatsAppContactForLead(
        prospect.record.prospectId,
        contactsQuery.data ?? [],
      )
    : null;
  const whatsappThreadQuery = useWhatsAppThreadQuery(
    whatsappContact?.waId ?? null,
  );
  const identityQuery = useIdentityQuery();
  const whatsappMessages = whatsappThreadQuery.data?.messages ?? [];
  const whatsappAgentPubkeys = [
    ...new Set(
      whatsappMessages
        .map((message) => message.senderPubkey)
        .filter((pubkey): pubkey is string =>
          Boolean(pubkey && pubkey !== identityQuery.data?.pubkey),
        ),
    ),
  ];
  const whatsappAgentProfilesQuery = useUsersBatchQuery(whatsappAgentPubkeys, {
    enabled: whatsappAgentPubkeys.length > 0,
  });
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
  const whatsappStatus = getWhatsAppLeadStatus(
    whatsappContact,
    inBatchLeadIds.has(record.prospectId),
  );
  const foundBy = campaignFor(provider, campaign, record.prospectId)?.runBy;
  const fit = person.fitScore;
  const discoveryMatches = person.discoveryTags ?? [];
  const discoveryFit = discoveryTagFitLabel(discoveryMatches);
  const discoveryTagGroups = groupDiscoveryTags(discoveryMatches);
  const outreachChannelId = statusQuery.data?.outreachChannelId;
  const sortedWhatsAppMessages = [...whatsappMessages].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const lastInboundWhatsApp = [...sortedWhatsAppMessages]
    .reverse()
    .find((message) => message.direction === "in");
  const lastOwnerWhatsAppReply = [...sortedWhatsAppMessages]
    .reverse()
    .find(
      (message) =>
        message.direction === "out" &&
        message.senderPubkey === identityQuery.data?.pubkey,
    );
  const firstTemplateWhatsApp = sortedWhatsAppMessages.find(
    (message) => message.templateName,
  );
  const firstTemplateTitle = statusQuery.data?.templates.find(
    (template) => template.name === firstTemplateWhatsApp?.templateName,
  )?.title;
  const firstTemplateAgent = firstTemplateWhatsApp?.senderPubkey
    ? whatsappAgentProfilesQuery.data?.profiles[
        firstTemplateWhatsApp.senderPubkey.toLowerCase()
      ]?.displayName?.trim()
    : null;
  const whatsappProgressStep = whatsappContact?.optedOut
    ? whatsappContact.lastInboundAt
      ? 3
      : 2
    : whatsappStatus === "replied"
      ? 3
      : whatsappStatus === "sent"
        ? 2
        : whatsappStatus === "in-batch"
          ? 1
          : 0;
  const whatsAppSteps = ["Not contacted", "In batch", "Sent", "Replied"];

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
              aria-labelledby="c3l-whatsapp-title"
              className="c3l-card c3l-panel c3l-whatsapp-panel c3l-whatsapp-detail"
              data-testid="whatsapp-lead-detail-card"
            >
              <div className="c3l-whatsapp-panel-head">
                <h2 className="c3l-panel-title-sm" id="c3l-whatsapp-title">
                  WhatsApp
                </h2>
                <span className={`c3l-whatsapp-status is-${whatsappStatus}`}>
                  {whatsappLeadStatusLabel(whatsappStatus)}
                </span>
                {whatsappContact && outreachChannelId ? (
                  <button
                    className="c3l-btn c3l-btn-primary c3l-btn-small c3l-whatsapp-detail-open"
                    onClick={() =>
                      void navigate({
                        to: "/channels/$channelId",
                        params: { channelId: outreachChannelId },
                        search: {
                          whatsappContactWaId: whatsappContact.waId,
                        },
                      })
                    }
                    type="button"
                  >
                    <ChatGlyph size={17} />
                    Open chat
                  </button>
                ) : null}
              </div>

              <ol aria-label="WhatsApp status" className="c3l-whatsapp-steps">
                {whatsAppSteps.map((step, index) => {
                  const stepState =
                    index < whatsappProgressStep
                      ? "complete"
                      : index === whatsappProgressStep
                        ? "current"
                        : "upcoming";
                  return (
                    <React.Fragment key={step}>
                      <li
                        aria-current={
                          stepState === "current" ? "step" : undefined
                        }
                        className={`c3l-whatsapp-step is-${stepState}`}
                      >
                        <span
                          aria-hidden="true"
                          className="c3l-whatsapp-step-mark"
                        >
                          {stepState === "complete" ? "✓" : index + 1}
                        </span>
                        {step}
                      </li>
                      {index < whatsAppSteps.length - 1 ? (
                        <li
                          aria-hidden="true"
                          className={`c3l-whatsapp-step-connector ${index < whatsappProgressStep ? "is-complete" : ""}`}
                        />
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </ol>

              {lastInboundWhatsApp ? (
                <blockquote className="c3l-whatsapp-last-message">
                  <p>“{lastInboundWhatsApp.text}”</p>
                  <span>
                    Last message · {person.contactName ?? "Contact"},{" "}
                    {whatsAppDay(lastInboundWhatsApp.createdAt)}{" "}
                    {whatsAppTime(lastInboundWhatsApp.createdAt)}
                    {lastOwnerWhatsAppReply
                      ? ` · you replied at ${whatsAppTime(lastOwnerWhatsAppReply.createdAt)}`
                      : ""}
                  </span>
                </blockquote>
              ) : (
                <p className="c3l-note">
                  {whatsappContact
                    ? "No reply has arrived yet."
                    : "No WhatsApp conversation is linked to this lead."}
                </p>
              )}

              <dl className="c3l-whatsapp-facts">
                <dt>Number</dt>
                <dd>
                  {whatsappContact
                    ? maskWhatsAppNumber(whatsappContact.e164)
                    : "Not set"}
                </dd>
                <dt>First message</dt>
                <dd>
                  {firstTemplateWhatsApp
                    ? `${firstTemplateTitle ?? "First message"} · sent by ${firstTemplateAgent ?? "an agent"} ${whatsAppDay(firstTemplateWhatsApp.createdAt)} at ${whatsAppTime(firstTemplateWhatsApp.createdAt)}`
                    : "No first message sent"}
                </dd>
                <dt>Reply window</dt>
                <dd
                  className={
                    whatsappContact?.windowOpen
                      ? "is-window-open"
                      : "is-window-closed"
                  }
                >
                  {whatsappContact?.optedOut
                    ? "Opted out"
                    : whatsappContact?.windowOpen
                      ? `Open, ${replyWindowRemaining(whatsappContact.windowClosesAt)}`
                      : "Closed"}
                </dd>
              </dl>
              <span className="c3l-whatsapp-opt-out-note">
                {whatsappContact?.optedOut
                  ? "This contact opted out. Future WhatsApp messages are locked."
                  : "If they reply stop or no thanks, the lead moves to Opted out and is never messaged again."}
              </span>
            </section>

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
                The WhatsApp chat lives in #Outreach. Notes and decisions stay
                with this lead.
              </p>
              <button
                className="c3l-btn c3l-btn-outline c3l-btn-small"
                disabled={!outreachChannelId}
                onClick={() => {
                  if (!outreachChannelId) return;
                  void navigate({
                    to: "/channels/$channelId",
                    params: { channelId: outreachChannelId },
                    search: {
                      threadRootId:
                        whatsappContact?.threadRootEventId ?? undefined,
                    },
                  });
                }}
                type="button"
              >
                <ChatGlyph size={17} />
                Go to #Outreach
              </button>
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
