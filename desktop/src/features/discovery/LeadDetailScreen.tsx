import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ListPlus, MessageCircle, Sparkles } from "lucide-react";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useRouteBack,
  useRouteOrigin,
} from "@/app/navigation/RouteOriginContext";

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
import { whatsappLeadStatusLabel } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import { customerActions } from "@/features/cofounder/customerActions";
import {
  useCustomerRecordAction,
  useCustomerRecords,
} from "@/features/cofounder/customerHooks";
import { useCustomerRecordCapabilities } from "@/features/cofounder/customerRecordAccess";
import { CloseOpportunityDialog } from "./LeadDialogs";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { AddToOutreachListDialog } from "./AddToOutreachListDialog";
import { OutreachBatchDialog } from "./OutreachBatchDialog";
import {
  campaignFor,
  ChatGlyph,
  LeadBreadcrumb,
  LeadPill,
  RunnerMark,
} from "./LeadParts";
import { buildLeadLink } from "@/shared/lib/entityLink";
import type { OutreachBatchLead } from "./outreachBatch";
import { normalizeOutreachPhone } from "./outreachBatch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DiscoveryLeadTags } from "./DiscoveryLeadTags";
import { discoveryTagFitLabel, groupDiscoveryTags } from "./discoveryTags";
import { buildQualificationDraftContext } from "./qualifyDraftContext";
import { qualificationSignalDefinition } from "./qualificationCampaign";
import {
  qualificationCheckedDate,
  qualificationNotChecked,
  qualificationObserved,
  qualificationReason,
} from "./qualificationPresentation";
import {
  canEdit,
  displayWebsite,
  findScoutDirectMessage,
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

function qualificationEvidenceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function QualificationLeadFound({
  checkedAt,
  facts,
  incomplete,
  draft,
}: {
  checkedAt: number;
  facts: ReturnType<typeof qualificationObserved>;
  incomplete: ReturnType<typeof qualificationNotChecked>;
  draft: ReturnType<typeof buildQualificationDraftContext>;
}) {
  const approvalFacts = draft.approvalEvidence.slice(0, 2);

  return (
    <div className="c3q-lead-found-layout">
      <section
        aria-labelledby="c3q-what-found-title"
        className="c3l-card c3q-lead-found-card"
        data-testid="lead-qualification-findings"
      >
        <div className="c3q-lead-found-heading">
          <h2 id="c3q-what-found-title">What we found on their website</h2>
          <span>Checked {qualificationCheckedDate(checkedAt)}</span>
        </div>
        {facts.length ? (
          <div className="c3q-lead-found-list">
            {facts.map((fact) => {
              const definition = qualificationSignalDefinition(
                fact.observation.signal,
              );
              return (
                <article key={fact.observation.signal}>
                  <span
                    className={`c3q-certainty is-${fact.certainty.toLocaleLowerCase()}`}
                  >
                    {fact.certainty}
                  </span>
                  <div>
                    <strong>{fact.label}</strong>
                    <p>{definition.description}</p>
                    <span className="c3q-finding-meta">
                      Checked{" "}
                      {qualificationCheckedDate(fact.observation.observedAt)}
                    </span>
                    {fact.observation.evidenceUrls.map((url) => (
                      <a
                        href={url}
                        key={url}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        Evidence: {qualificationEvidenceLabel(url)}
                      </a>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="c3l-note">No selected website facts were observed.</p>
        )}
        {incomplete.length ? (
          <div className="c3q-not-checked-list">
            {incomplete.map((observation) => (
              <p key={observation.signal}>
                <span>Not checked</span>
                {qualificationSignalDefinition(observation.signal).label}:{" "}
                {qualificationReason(observation.notCheckedReason)}
              </p>
            ))}
          </div>
        ) : null}
        <div className="c3q-lead-found-footer">
          <a className="c3q-check-again" href="#/leads">
            Check again
          </a>
          <span>Facts older than 30 days are not used in messages.</span>
        </div>
      </section>

      <aside
        aria-labelledby="c3q-draft-evidence-title"
        className="c3q-scout-draft-card"
      >
        <div className="c3q-scout-draft-heading">
          <span aria-hidden="true" className="c3q-scout-mark">
            S
          </span>
          <h2 id="c3q-draft-evidence-title">Scout's draft evidence</h2>
        </div>
        {approvalFacts.length ? (
          <>
            <div className="c3q-draft-preview">
              Scout can use{" "}
              {approvalFacts.map((fact, index) => (
                <React.Fragment key={fact.signal}>
                  {index > 0 ? " and " : null}
                  <mark>{fact.statement}</mark>
                </React.Fragment>
              ))}{" "}
              when it prepares a draft for your approval.
            </div>
            <div className="c3q-draft-why">
              <span>Why Scout said this</span>
              <ol>
                {approvalFacts.map((fact, index) => (
                  <li key={fact.signal}>
                    <span>{index + 1}</span>
                    <p>
                      {fact.certainty === "likely"
                        ? `Likely: ${fact.statement}`
                        : fact.statement}{" "}
                      {fact.evidenceUrls.map((url) => (
                        <a
                          href={url}
                          key={url}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          {qualificationEvidenceLabel(url)}
                        </a>
                      ))}{" "}
                      checked {qualificationCheckedDate(fact.observedAt)}.
                    </p>
                  </li>
                ))}
              </ol>
              <p>
                Facts marked Likely are worded as "I couldn't find" before Scout
                puts them in a draft.
              </p>
            </div>
          </>
        ) : (
          <p className="c3q-draft-empty">
            Scout needs fresh, evidence-backed findings before it can suggest a
            sentence for approval.
          </p>
        )}
      </aside>
    </div>
  );
}

export function LeadDetailScreen({
  prospect,
  ...context
}: LeadContext & { prospect: ProspectRow | null }) {
  const navigate = useNavigate();
  const routeBack = useRouteBack({
    to: "/leads",
    label: "All leads",
    breadcrumbs: ["Business", "Sales", "Leads"],
  });
  const routeOrigin = useRouteOrigin();
  const channelsQuery = useChannelsQuery();
  const { campaign, provider } = useDiscoveryCampaign();
  const { statusQuery, contactsQuery, inBatchLeadIds } = useWhatsAppLeadData();
  const customerAccess = useCustomerRecordCapabilities();
  const customerRecordsQuery = useCustomerRecords(customerAccess.enabled);
  const customerAction = useCustomerRecordAction();
  const whatsappContact = prospect
    ? findWhatsAppContactForLead(
        prospect.record.prospectId,
        contactsQuery.data ?? [],
      )
    : null;
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lostError, setLostError] = React.useState("");
  const [activity, setActivity] = React.useState("");
  const [conversionError, setConversionError] = React.useState("");
  const [scoutMessage, setScoutMessage] = React.useState("");
  const [addToListOpen, setAddToListOpen] = React.useState(false);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [whatsAppNumberOpen, setWhatsAppNumberOpen] = React.useState(false);
  const [whatsAppNumberDraft, setWhatsAppNumberDraft] = React.useState("");
  const [whatsAppNumberError, setWhatsAppNumberError] = React.useState("");
  const [activityType, setActivityType] = React.useState<string>(
    ACTIVITY_TYPES[0],
  );
  const [lostOpen, setLostOpen] = React.useState(false);
  const canWrite = canEdit(context.role) && Boolean(context.currentPubkey);

  React.useEffect(() => {
    if (!prospect) return;
    const name = prospect.record.prospect.party.displayName;
    routeOrigin.savePageSnapshot({
      backLabel: name,
      breadcrumbs: [...routeBack.breadcrumbs, name],
      scrollY: window.scrollY,
    });
  }, [prospect, routeBack.breadcrumbs, routeOrigin.savePageSnapshot]);

  if (!prospect) {
    return (
      <main className="c3l-page" data-testid="w10-prospect-unavailable">
        <div className="c3l-wrap">
          <div className="c3l-card c3l-empty">
            <h1>This prospect is unavailable.</h1>
            <p>Return to the result list and try another profile.</p>
            <button
              className="c3l-btn c3l-btn-outline"
              onClick={routeBack.goBack}
              type="button"
            >
              {routeBack.backLabel}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const record = prospect.record;
  const person = record.prospect;
  const name = person.party.displayName;
  const customerRecord = customerRecordsQuery.data?.find(
    (candidate) => candidate.partyId === person.party.partyId,
  );
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
  const memberLists = context.records.outreachLists.filter(
    ({ record: list }) =>
      list.status === "active" &&
      list.members.some((member) => member.leadId === record.prospectId),
  );
  const batchLead: OutreachBatchLead = {
    leadId: record.prospectId,
    name,
    contactName: person.contactName,
    phone: person.phone,
    whatsappPhone: person.whatsappPhone,
  };
  const whatsappNumber =
    person.whatsappPhone?.trim() ||
    person.phone?.trim() ||
    whatsappContact?.e164 ||
    "";
  const phoneSource = person.evidence.find((item) =>
    /google maps/i.test(item.title),
  )?.title;
  const qualificationHead =
    context.records.qualificationObservations.find(
      (head) => head.record.leadId === record.prospectId,
    )?.record ?? null;
  const qualificationFacts = qualificationObserved(qualificationHead);
  const qualificationIncomplete = qualificationNotChecked(qualificationHead);
  const qualificationDraft = buildQualificationDraftContext(
    qualificationHead,
    Math.floor(Date.now() / 1_000),
  );

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

  async function makeClient() {
    if (!customerRecord) return;
    setConversionError("");
    try {
      await customerAction.mutateAsync(
        customerActions.convertToClient(customerRecord),
      );
    } catch (convertError) {
      setConversionError(
        convertError instanceof Error && convertError.message.trim()
          ? convertError.message
          : "The lead could not be converted. Open the customer record and try again.",
      );
    }
  }

  async function askScout() {
    setScoutMessage("");
    let copied = false;
    try {
      await navigator.clipboard.writeText(
        `Please research this lead and update its record: ${buildLeadLink(record.prospectId)}`,
      );
      copied = true;
    } catch {
      copied = false;
    }
    try {
      const channels =
        channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
      const scoutDm = findScoutDirectMessage(channels);
      if (!scoutDm) {
        setScoutMessage(
          copied
            ? "Lead reference copied. Scout's chat is unavailable."
            : "Scout's chat is unavailable and the lead reference could not be copied.",
        );
        return;
      }
      setScoutMessage(
        copied
          ? "Lead reference copied."
          : "Could not copy the lead reference.",
      );
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: scoutDm.id },
      });
    } catch {
      setScoutMessage(
        copied
          ? "Lead reference copied. Scout's chat could not be opened."
          : "Could not copy the lead reference or open Scout's chat.",
      );
    }
  }

  async function saveWhatsAppNumber(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeOutreachPhone(whatsAppNumberDraft);
    if (!normalized) {
      setWhatsAppNumberError(
        "Enter a valid phone number with its country code.",
      );
      return;
    }
    setWhatsAppNumberError("");
    const saved = await saveProspect(
      { ...currentChanges, whatsappPhone: normalized },
      { activityKind: "contact", content: "WhatsApp number updated." },
      setWhatsAppNumberError,
    );
    if (saved) setWhatsAppNumberOpen(false);
  }

  async function resetWhatsAppNumber() {
    setWhatsAppNumberError("");
    const saved = await saveProspect(
      { ...currentChanges, whatsappPhone: null },
      {
        activityKind: "contact",
        content: "WhatsApp number reset to the business phone.",
      },
      setWhatsAppNumberError,
    );
    if (saved) setWhatsAppNumberOpen(false);
  }

  return (
    <main className="c3l-page" data-testid="w10-prospect-page">
      <LeadBreadcrumb
        backLabel={routeBack.backLabel}
        name={name}
        onBack={routeBack.goBack}
        parent={routeBack.breadcrumbs}
      />
      <div className="c3l-wrap c3l-wrap-detail">
        <div className="c3l-head">
          <div className="c3l-head-identity">
            <BusinessLogoMark
              className="c3l-mark c3l-mark-large"
              logoUrl={person.logoUrl}
              name={name}
              placePhotoUrl={person.placePhotoUrl}
              website={person.website}
            />
            <div className="c3l-head-text">
              <h1 className="c3l-title">{name}</h1>
              <span className="c3l-subtitle">
                {person.vertical} · {person.location ?? "Location not set"}
                <LeadPill
                  tone={toneForStage(person.stage, person.qualification)}
                >
                  {labelForStage(person.stage, person.qualification, "New")}
                </LeadPill>
              </span>
            </div>
          </div>
          <div className="c3l-head-actions">
            <button
              className="c3l-btn c3l-btn-outline"
              onClick={() => void askScout()}
              type="button"
            >
              <Sparkles aria-hidden="true" size={15} /> Ask Scout
            </button>
            {customerAccess.enabled &&
            customerAccess.canConvert &&
            customerRecord?.stage === "lead" ? (
              <button
                className="c3l-btn c3l-btn-primary"
                data-testid={`lead-make-client-${person.party.partyId}`}
                disabled={customerAction.isPending}
                onClick={() => void makeClient()}
                type="button"
              >
                Make client
              </button>
            ) : null}
          </div>
        </div>
        {conversionError ? (
          <p className="c3l-conversion-error" role="alert">
            {conversionError}
          </p>
        ) : null}

        {qualificationHead ? (
          <QualificationLeadFound
            checkedAt={qualificationHead.checkedAt}
            draft={qualificationDraft}
            facts={qualificationFacts}
            incomplete={qualificationIncomplete}
          />
        ) : null}

        <div className="c3l-contact-whatsapp-grid">
          <section
            aria-labelledby="c3l-contact-title"
            className="c3l-card c3l-panel c3l-contact-panel"
          >
            <h2 className="c3l-panel-title-sm" id="c3l-contact-title">
              Contact
            </h2>
            <dl className="c3l-contact-facts">
              <div>
                <dt>Phone</dt>
                <dd>
                  {person.phone?.trim() ? (
                    <a href={`tel:${person.phone}`}>{person.phone}</a>
                  ) : (
                    "Not set"
                  )}
                  {phoneSource ? <small>from {phoneSource}</small> : null}
                </dd>
              </div>
              <div>
                <dt>Contact person</dt>
                <dd>{person.contactName ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Website</dt>
                <dd>
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
              </div>
              <div>
                <dt>Address</dt>
                <dd>{person.location ?? "Not set"}</dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="c3l-whatsapp-title"
            className="c3l-card c3l-panel c3l-contact-panel c3l-whatsapp-summary"
            data-testid="whatsapp-lead-detail-card"
          >
            <h2 className="c3l-panel-title-sm" id="c3l-whatsapp-title">
              WhatsApp
            </h2>
            <dl className="c3l-contact-facts c3l-whatsapp-summary-facts">
              <div>
                <dt>Number</dt>
                <dd>
                  <strong>{whatsappNumber || "Not set"}</strong>
                  <small>
                    {person.whatsappPhone
                      ? "Using the saved WhatsApp number."
                      : person.phone
                        ? "Uses the business phone."
                        : whatsappContact?.e164
                          ? "WhatsApp contact number"
                          : "Add a business phone to prepare a message."}{" "}
                    <button
                      className="c3l-inline-link"
                      disabled={!canWrite}
                      onClick={() => {
                        setWhatsAppNumberDraft(person.whatsappPhone ?? "");
                        setWhatsAppNumberError("");
                        setWhatsAppNumberOpen(true);
                      }}
                      type="button"
                    >
                      Use another number
                    </button>
                  </small>
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`c3l-whatsapp-status is-${whatsappStatus}`}>
                    {whatsappLeadStatusLabel(whatsappStatus)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Lists</dt>
                <dd className="c3l-lead-list-memberships">
                  {memberLists.length ? (
                    memberLists.map(({ record: list }) => (
                      <a
                        className="c3l-lead-list-chip"
                        href={`#/lists/${list.listId}`}
                        key={list.listId}
                      >
                        <ListPlus aria-hidden="true" size={13} />
                        {list.name}
                      </a>
                    ))
                  ) : (
                    <span className="c3l-muted">Not in a list</span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="c3l-contact-actions">
              <button
                className="c3l-btn c3l-btn-primary"
                disabled={!canWrite || !whatsappNumber}
                onClick={() => setBatchOpen(true)}
                type="button"
              >
                <MessageCircle aria-hidden="true" size={15} /> Prepare a message
              </button>
              <button
                className="c3l-btn c3l-btn-outline"
                disabled={!canWrite}
                onClick={() => setAddToListOpen(true)}
                type="button"
              >
                <ListPlus aria-hidden="true" size={15} /> Add to outreach list
              </button>
              {customerAccess.enabled && customerRecord ? (
                <a
                  className="c3l-btn c3l-btn-outline c3l-customer-record-action"
                  href={`#/clients/record/${person.party.partyId}`}
                >
                  Customer record
                </a>
              ) : null}
              {whatsappContact && outreachChannelId ? (
                <button
                  className="c3l-btn c3l-btn-outline c3l-contact-open-chat"
                  onClick={() =>
                    void navigate({
                      to: "/channels/$channelId",
                      params: { channelId: outreachChannelId },
                      search: { whatsappContactWaId: whatsappContact.waId },
                    })
                  }
                  type="button"
                >
                  <ChatGlyph size={16} /> Open chat
                </button>
              ) : null}
            </div>
          </section>
        </div>
        {scoutMessage ? (
          <p className="c3l-outreach-note" role="status">
            {scoutMessage}
          </p>
        ) : null}

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
              {conversionError ? (
                <p className="c3l-conversion-error" role="alert">
                  {conversionError}
                </p>
              ) : null}
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
      <AddToOutreachListDialog
        context={context}
        defaultName={`Selected leads, ${new Intl.DateTimeFormat("en-ZA", {
          day: "numeric",
          month: "short",
        }).format(new Date())}`}
        leadIds={[record.prospectId]}
        onOpenChange={setAddToListOpen}
        open={addToListOpen}
      />
      <OutreachBatchDialog
        leads={[batchLead]}
        listName={name}
        onOpenChange={setBatchOpen}
        open={batchOpen}
      />
      <Dialog
        onOpenChange={(open) => {
          setWhatsAppNumberOpen(open);
          if (!open) setWhatsAppNumberError("");
        }}
        open={whatsAppNumberOpen}
      >
        <DialogContent
          className="c3l-dialog-content"
          data-testid="whatsapp-number-dialog"
        >
          <DialogHeader>
            <DialogTitle>Use another WhatsApp number</DialogTitle>
            <DialogDescription>
              Save a WhatsApp number for this lead. It will be used instead of
              the business phone when preparing a message.
            </DialogDescription>
          </DialogHeader>
          <form
            className="c3l-outreach-dialog-form"
            onSubmit={(event) => void saveWhatsAppNumber(event)}
          >
            <label
              className="c3l-outreach-dialog-field"
              htmlFor="lead-whatsapp-number"
            >
              WhatsApp number
              <input
                autoFocus
                id="lead-whatsapp-number"
                inputMode="tel"
                maxLength={40}
                onChange={(event) =>
                  setWhatsAppNumberDraft(event.currentTarget.value)
                }
                placeholder="+27 82 555 4410"
                required
                type="tel"
                value={whatsAppNumberDraft}
              />
            </label>
            {whatsAppNumberError ? (
              <p className="c3l-outreach-error" role="alert">
                {whatsAppNumberError}
              </p>
            ) : null}
            <div className="c3l-outreach-dialog-actions">
              <button
                className="c3l-btn c3l-btn-outline c3l-btn-small"
                disabled={saving || !canWrite || !person.phone?.trim()}
                onClick={() => void resetWhatsAppNumber()}
                type="button"
              >
                Use business phone
              </button>
              <button
                className="c3l-btn c3l-btn-outline c3l-btn-small"
                disabled={saving}
                onClick={() => setWhatsAppNumberOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="c3l-btn c3l-btn-primary c3l-btn-small"
                disabled={saving || !canWrite}
                type="submit"
              >
                {saving ? "Saving..." : "Save number"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
