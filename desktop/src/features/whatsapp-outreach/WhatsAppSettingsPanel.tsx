import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { SettingsOptionGroup } from "@/features/settings/ui/SettingsOptionGroup";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  loadWhatsAppTemplates,
  whatsappCommandKinds,
} from "./whatsappOutreachApi";
import {
  getWhatsAppDailyCapProgress,
  whatsappQualityLabel,
  whatsappTemplateDisplayTitle,
  whatsappTemplateMetaName,
  type WhatsAppTemplate,
} from "./whatsappOutreachModels";
import { WhatsAppPendingBatches } from "./WhatsAppPendingBatches";
import {
  useInvalidateWhatsAppQueries,
  useWhatsAppCommand,
  useWhatsAppContactsQuery,
  useWhatsAppRelayUrl,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
  whatsappOutreachQueryKeys,
} from "./whatsappOutreachQueries";
import "./whatsappOutreach.css";

const TEMPLATE_GROUPS = ["Openers", "Follow-ups", "Payments", "Other"] as const;
const TEMPLATE_ORDER = [
  "hl_vb",
  "hl_hs_v1",
  "hl_hs_v2",
  "hl_hs_v3",
  "hl_ns_v1",
  "hl_ns_v2",
  "hl_ns_v3",
  "hl_ns_v4",
  "hl_ns_v5",
  "hl_fu_v1",
  "hl_fu_v2",
  "hl_pay",
] as const;

function orderTemplates(templates: readonly WhatsAppTemplate[]) {
  const rank = new Map<string, number>(
    TEMPLATE_ORDER.map((name, index) => [name, index]),
  );
  return [...templates].sort((left, right) => {
    const leftRank = rank.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
}

function templateGroup(
  template: WhatsAppTemplate,
): (typeof TEMPLATE_GROUPS)[number] {
  if (template.name.startsWith("hl_fu_")) return "Follow-ups";
  if (template.name === "hl_pay") return "Payments";
  if (template.name.startsWith("hl_") || template.name === "hello_world") {
    return "Openers";
  }
  return "Other";
}

function templatePreview(template: WhatsAppTemplate) {
  const firstLine = template.body.split("\n", 1)[0] ?? template.body;
  const segments = firstLine.split(/(\{\{\d+\}\})/gu);
  const slotLabels = ["business type", "area", "preview link"];
  let position = 0;
  const keyedSegments = segments.map((segment) => {
    const keyedSegment = { key: `${position}:${segment}`, segment };
    position += segment.length;
    return keyedSegment;
  });

  return keyedSegments.map(({ key, segment }) => {
    const slot = /^\{\{(\d+)\}\}$/u.exec(segment);
    if (!slot) return <React.Fragment key={key}>{segment}</React.Fragment>;
    const label = slotLabels[Number(slot[1]) - 1] ?? "detail";
    return <em key={key}>{label}</em>;
  });
}

function templateBodyPreview(template: WhatsAppTemplate) {
  const segments = template.body.split(/(\{\{\d+\}\})/gu);
  const slotLabels = ["business type", "area", "preview link"];
  let position = 0;
  const keyedSegments = segments.map((segment) => {
    const keyedSegment = { key: `${position}:${segment}`, segment };
    position += segment.length;
    return keyedSegment;
  });
  return keyedSegments.map(({ key, segment }) => {
    const slot = /^\{\{(\d+)\}\}$/u.exec(segment);
    if (!slot) return <React.Fragment key={key}>{segment}</React.Fragment>;
    const label = slotLabels[Number(slot[1]) - 1] ?? "detail";
    return <em key={key}>{label}</em>;
  });
}

function TemplateRow({
  canManage,
  onRename,
  template,
}: {
  canManage: boolean;
  onRename: (template: WhatsAppTemplate, title: string) => Promise<void>;
  template: WhatsAppTemplate;
}) {
  const [expanded, setExpanded] = React.useState(template.name === "hl_vb");
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(template.title);
  const [saving, setSaving] = React.useState(false);
  const metaName = whatsappTemplateMetaName(template, expanded);
  const detailsRef = React.useRef<HTMLDetailsElement>(null);

  React.useEffect(() => setTitle(template.title), [template.title]);

  async function submitTitle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 80) return;
    setSaving(true);
    try {
      await onRename(template, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="c3wa-template"
      data-testid={`whatsapp-template-${template.name}`}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
      ref={detailsRef}
    >
      <summary className="c3wa-template-summary">
        <span aria-hidden="true" className="c3wa-template-chevron">
          ›
        </span>
        <span className="c3wa-template-copy">
          <strong>{whatsappTemplateDisplayTitle(template)}</strong>
          <span className="c3wa-template-preview">
            {templatePreview(template)}
          </span>
        </span>
        <span
          className={cn(
            "c3wa-template-category",
            template.category.toLocaleUpperCase() === "UTILITY"
              ? "is-utility"
              : "is-marketing",
          )}
        >
          {template.category.toLocaleLowerCase()}
        </span>
        <span
          className={cn(
            "c3wa-template-status",
            template.status.toLocaleUpperCase() === "APPROVED"
              ? "is-approved"
              : "is-pending",
          )}
        >
          {template.status.toLocaleUpperCase() === "APPROVED"
            ? "✓ Approved"
            : template.status.toLocaleLowerCase()}
        </span>
        {canManage ? (
          <Button
            className="c3wa-template-rename"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (detailsRef.current) detailsRef.current.open = true;
              setExpanded(true);
              setEditing(true);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Rename
          </Button>
        ) : null}
      </summary>
      <div className="c3wa-template-details">
        <p className="c3wa-template-body">{templateBodyPreview(template)}</p>
        {template.buttons.length ? (
          <div className="c3wa-template-buttons">
            {template.buttons.map((button) => (
              <span key={`${button.type}:${button.text}`}>{button.text}</span>
            ))}
          </div>
        ) : null}
        <p className="c3wa-template-meta">
          <span>Meta name:</span> <strong>{metaName}</strong>
        </p>
        {template.proposedTitle ? (
          <p className="c3wa-proposed-title">
            Suggested by an agent: <strong>{template.proposedTitle}</strong>
          </p>
        ) : null}
        {editing ? (
          <form
            className="c3wa-title-edit"
            onSubmit={(event) => void submitTitle(event)}
          >
            <label
              className="c3wa-sr-only"
              htmlFor={`wa-template-title-${template.name}`}
            >
              Colony display title
            </label>
            <input
              id={`wa-template-title-${template.name}`}
              maxLength={80}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
            <Button
              disabled={!canManage || saving || !title.trim()}
              type="submit"
            >
              {saving ? "Saving" : "Save title"}
            </Button>
            <Button
              onClick={() => setEditing(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

export function WhatsAppSettingsPanel() {
  const relayUrl = useWhatsAppRelayUrl();
  const membership = useMyRelayMembershipLookupQuery();
  const role = membership.data?.membership?.role;
  const canManage =
    membership.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";
  const statusQuery = useWhatsAppStatusQuery();
  const contactsQuery = useWhatsAppContactsQuery(
    statusQuery.data?.connected === true,
  );
  const templatesQuery = useWhatsAppTemplatesQuery(
    statusQuery.data?.connected === true,
  );
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWhatsAppQueries();
  const command = useWhatsAppCommand();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [capDraft, setCapDraft] = React.useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState("wa-number");

  const status = statusQuery.data;
  const templates = templatesQuery.data ?? status?.templates ?? [];
  const orderedTemplates = React.useMemo(
    () => orderTemplates(templates),
    [templates],
  );
  const progress = status
    ? getWhatsAppDailyCapProgress(
        status.newChatsSentToday,
        status.dailyNewChatCap,
      )
    : null;

  React.useEffect(() => {
    setCapDraft(status ? String(status.dailyNewChatCap) : null);
  }, [status?.dailyNewChatCap, status]);

  async function submitConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!relayUrl || !canManage || busy) return;
    setError("");
    setSuccess("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const credentials = {
      accessToken: String(formData.get("accessToken") ?? ""),
      phoneNumberId: String(formData.get("phoneNumberId") ?? "").trim(),
      wabaId: String(formData.get("wabaId") ?? "").trim(),
      appSecret: String(formData.get("appSecret") ?? ""),
    };
    form.reset();
    if (Object.values(credentials).some((value) => !value)) {
      setError("Enter all four details from Meta for Developers.");
      return;
    }
    setBusy(true);
    try {
      const connected = await connectWhatsApp(relayUrl, credentials);
      queryClient.setQueryData(
        whatsappOutreachQueryKeys.status(relayUrl),
        connected,
      );
      await invalidate();
      setSuccess("Your WhatsApp number is connected.");
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect this number.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveCap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !status || !capDraft || busy) return;
    const cap = Number(capDraft);
    if (!Number.isInteger(cap) || cap < 0 || cap > 1000) {
      setError("Choose a daily cap from 0 to 1,000.");
      return;
    }
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await command(whatsappCommandKinds.settings, {
        v: 1,
        dailyNewChatCap: cap,
      });
      setSuccess("Daily cap saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the cap.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function setPaused(paused: boolean) {
    if (!canManage || !status || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await command(whatsappCommandKinds.settings, {
        v: 1,
        sendingPaused: paused,
      });
      setSuccess(
        paused
          ? "All WhatsApp sending is paused."
          : "WhatsApp sending resumed.",
      );
    } catch (pauseError) {
      setError(
        pauseError instanceof Error
          ? pauseError.message
          : "Could not update sending pause.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function syncTemplates() {
    if (!relayUrl || !canManage || busy) return;
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      const synced = await loadWhatsAppTemplates(relayUrl, true);
      queryClient.setQueryData(
        whatsappOutreachQueryKeys.templates(relayUrl),
        synced,
      );
      await invalidate();
      setSuccess("Templates synced from Meta.");
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Could not sync templates.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameTemplate(template: WhatsAppTemplate, title: string) {
    if (!canManage) return;
    setError("");
    setSuccess("");
    await command(whatsappCommandKinds.settings, {
      v: 1,
      templateTitle: {
        template: template.name,
        language: template.language,
        title,
        propose: false,
      },
    });
    setSuccess("Colony display title saved.");
  }

  async function disconnect() {
    if (!relayUrl || !canManage || busy) return;
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const disconnected = await disconnectWhatsApp(relayUrl);
      queryClient.setQueryData(
        whatsappOutreachQueryKeys.status(relayUrl),
        disconnected,
      );
      setConfirmDisconnect(false);
      await invalidate();
      setSuccess(
        "WhatsApp is disconnected. Your chat history remains in Colony.",
      );
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Could not disconnect WhatsApp.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (statusQuery.isPending) {
    return (
      <div aria-busy="true" className="c3wa-loading">
        Loading WhatsApp settings…
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <section
        className="c3wa-root c3wa-settings"
        data-testid="whatsapp-settings"
      >
        <div className="c3wa-alert" role="alert">
          {statusQuery.error.message}
        </div>
        <Button
          onClick={() => void statusQuery.refetch()}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </section>
    );
  }

  if (!status) return null;

  return (
    <section
      className="c3wa-root c3wa-settings"
      data-testid="whatsapp-settings"
    >
      {!canManage ? (
        <p className="c3wa-readonly-note">
          Only a workspace owner or admin can change WhatsApp settings.
        </p>
      ) : null}
      {error ? (
        <div className="c3wa-alert" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="c3wa-success" role="status">
          {success}
        </div>
      ) : null}

      <WhatsAppPendingBatches canManage={canManage} templates={templates} />

      {!status.connected ? (
        <>
          <SettingsOptionGroup className="c3wa-group">
            <div className="c3wa-connect-intro">
              <header>
                <h2>Connect your business number</h2>
                <span>Not connected</span>
              </header>
              <p>
                Colony uses the official WhatsApp Cloud API from Meta. Scout
                prepares each batch and you approve it before anything is sent.
                Replies come back to a private #Outreach channel.
              </p>
              <div className="c3wa-prerequisites">
                <p>
                  <span>1</span>A verified business number in Meta Business
                  Manager.
                </p>
                <p>
                  <span>2</span>An app in Meta for Developers with WhatsApp
                  added.
                </p>
                <p>
                  <span>3</span>Your four details below, copied from that app.
                </p>
              </div>
            </div>
          </SettingsOptionGroup>

          <SettingsOptionGroup className="c3wa-group">
            <form
              aria-labelledby="wa-connect-title"
              className="c3wa-connect-form"
              data-testid="whatsapp-connect-form"
              onSubmit={(event) => void submitConnect(event)}
            >
              <h2 id="wa-connect-title">Details from Meta for Developers</h2>
              <p className="c3wa-connect-description">
                The access token and app secret are write-only. Colony clears
                them from the form as soon as you connect.
              </p>
              <div className="c3wa-form-grid">
                <div className="cs-field">
                  <label className="cs-label" htmlFor="wa-access-token">
                    Access token
                  </label>
                  <input
                    autoComplete="off"
                    className="cs-input"
                    data-testid="wa-access-token"
                    id="wa-access-token"
                    name="accessToken"
                    placeholder="Paste the token"
                    required
                    type="password"
                  />
                  <span className="cs-help">
                    Your app › WhatsApp › API Setup. Use a permanent system user
                    token.
                  </span>
                </div>
                <div className="cs-field">
                  <label className="cs-label" htmlFor="wa-phone-number-id">
                    Phone number ID
                  </label>
                  <input
                    autoComplete="off"
                    className="cs-input"
                    data-testid="wa-phone-number-id"
                    id="wa-phone-number-id"
                    inputMode="numeric"
                    name="phoneNumberId"
                    pattern="[0-9]+"
                    placeholder="Numbers only"
                    required
                  />
                  <span className="cs-help">
                    WhatsApp › API Setup, under your business number.
                  </span>
                </div>
                <div className="cs-field">
                  <label className="cs-label" htmlFor="wa-waba-id">
                    WhatsApp business account ID
                  </label>
                  <input
                    autoComplete="off"
                    className="cs-input"
                    data-testid="wa-waba-id"
                    id="wa-waba-id"
                    inputMode="numeric"
                    name="wabaId"
                    pattern="[0-9]+"
                    placeholder="Numbers only"
                    required
                  />
                  <span className="cs-help">
                    WhatsApp › API Setup, next to the phone number ID.
                  </span>
                </div>
                <div className="cs-field">
                  <label className="cs-label" htmlFor="wa-app-secret">
                    App secret
                  </label>
                  <input
                    autoComplete="off"
                    className="cs-input"
                    data-testid="wa-app-secret"
                    id="wa-app-secret"
                    name="appSecret"
                    placeholder="Paste the secret"
                    required
                    type="password"
                  />
                  <span className="cs-help">
                    App settings › Basic › App secret. Proves replies really
                    come from Meta.
                  </span>
                </div>
              </div>
              <div className="c3wa-privacy-note">
                <span aria-hidden="true">⌑</span>The token and secret are stored
                encrypted and never shown again after you save.
              </div>
              <div className="c3wa-connect-actions">
                <Button
                  disabled={!canManage || busy}
                  data-testid="whatsapp-connect-submit"
                  type="submit"
                >
                  {busy ? "Connecting…" : "Connect"}
                </Button>
                <p>
                  Next, Colony shows the callback URL and verify token to paste
                  into WhatsApp › Configuration.
                </p>
              </div>
            </form>
          </SettingsOptionGroup>
        </>
      ) : (
        <>
          <nav aria-label="WhatsApp sections" className="c3wa-subnav">
            {[
              { id: "wa-number", label: "Number" },
              { id: "wa-sending", label: "Sending" },
              { id: "wa-templates", label: "Templates" },
            ].map((item) => (
              <button
                aria-current={activeSection === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  const section = document.getElementById(item.id);
                  if (!section) return;
                  const behavior = window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth";
                  section.scrollIntoView({ behavior, block: "start" });
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <SettingsOptionGroup className="c3wa-group">
            <div className="c3wa-number-card" id="wa-number">
              <span className="c3wa-number-mark" aria-hidden="true">
                HL
              </span>
              <div className="c3wa-number-copy">
                <strong>{status.verifiedName ?? "WhatsApp Business"}</strong>
                <span>{status.displayPhoneNumber ?? "Number unavailable"}</span>
              </div>
              <span className="c3wa-connected-chip">✓ Connected</span>
            </div>
            <dl className="c3wa-number-details">
              <dt>Quality</dt>
              <dd>
                <span
                  className={cn(
                    "c3wa-quality-dot",
                    `is-${status.quality ?? "unknown"}`,
                  )}
                />
                {whatsappQualityLabel(status.quality)}
                <span className="c3wa-detail-hint">·</span>
                <span className="c3wa-detail-hint">
                  {status.quality === "green"
                    ? "people are responding well"
                    : status.quality === "yellow"
                      ? "quality needs attention"
                      : status.quality === "red"
                        ? "sending is stopped"
                        : "quality unavailable"}
                </span>
              </dd>
              <dt>Replies go to</dt>
              <dd>
                <a
                  href={
                    status.outreachChannelId
                      ? `/channels/${status.outreachChannelId}`
                      : undefined
                  }
                >
                  #Outreach
                </a>
                <span className="c3wa-detail-hint">
                  · private, only in Colony
                </span>
              </dd>
              <dt>Connection</dt>
              <dd>WhatsApp Cloud API · verified business</dd>
            </dl>
            {status.issues.length ? (
              <div className="c3wa-issue-list" role="status">
                {status.issues.map((issue) => (
                  <p key={`${issue.code}:${issue.at}`}>{issue.message}</p>
                ))}
              </div>
            ) : null}
          </SettingsOptionGroup>

          <SettingsOptionGroup className="c3wa-group">
            <div className="c3wa-sending" id="wa-sending">
              <header className="c3wa-section-head">
                <h2>Sending</h2>
                <span
                  className={cn(
                    "c3wa-chip",
                    status.sendingPaused ? "is-yellow" : "is-green",
                  )}
                >
                  {status.sendingPaused ? "Sending is paused" : "Sending is on"}
                </span>
              </header>
              <div className="c3wa-pause-row">
                <div>
                  <strong>Pause all sending</strong>
                  <span>
                    Stops new chats and agent replies at once. Nothing waiting
                    is lost.
                  </span>
                </div>
                <button
                  aria-checked={status.sendingPaused}
                  aria-label="Pause all WhatsApp sending"
                  className="c3wa-switch"
                  data-testid="whatsapp-pause-switch"
                  disabled={!canManage || busy}
                  onClick={() => void setPaused(!status.sendingPaused)}
                  role="switch"
                  type="button"
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              {status.pauseReason ? (
                <p className="c3wa-pause-reason">{status.pauseReason}</p>
              ) : null}
              <div className="c3wa-send-approval">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>
                    Agents’ replies and follow-ups wait for your OK
                  </strong>
                  <span>
                    A batch approval covers only the first message to each lead.
                    Messages you type yourself send at once.
                  </span>
                </div>
                <span className="c3wa-always-on">✓ Always on</span>
              </div>
              <div className="c3wa-cap-progress">
                <div>
                  <strong>New chats today</strong>
                  <span>
                    <b>{progress?.sent ?? 0}</b> of{" "}
                    {progress?.cap ?? status.dailyNewChatCap}
                  </span>
                </div>
                <div
                  className="c3wa-progress-track"
                  role="progressbar"
                  aria-label="New chats today"
                  aria-valuemax={progress?.cap ?? 0}
                  aria-valuemin={0}
                  aria-valuenow={Math.min(
                    progress?.sent ?? 0,
                    progress?.cap ?? 0,
                  )}
                >
                  <span style={{ width: `${progress?.percentage ?? 0}%` }} />
                </div>
                <p id="wa-cap-progress">
                  Replies are never capped. New chats over the cap wait for
                  tomorrow.
                </p>
              </div>
              <form
                className="c3wa-cap-form"
                onSubmit={(event) => void saveCap(event)}
              >
                <div className="c3wa-cap-copy">
                  <label htmlFor="wa-daily-cap">Daily cap on new chats</label>
                  <span>Starts at 30. Change it any time.</span>
                </div>
                <div className="c3wa-cap-control">
                  <input
                    aria-describedby="wa-cap-progress"
                    data-testid="whatsapp-daily-cap"
                    id="wa-daily-cap"
                    inputMode="numeric"
                    max={1000}
                    min={0}
                    onChange={(event) => setCapDraft(event.currentTarget.value)}
                    type="number"
                    value={capDraft ?? status.dailyNewChatCap}
                  />
                  <Button
                    disabled={!canManage || busy}
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    Save cap
                  </Button>
                </div>
              </form>
              <div className="c3wa-opt-outs">
                <div>
                  <strong>Opt-outs</strong>
                  <span>
                    Anyone who replies stop or no thanks is never messaged
                    again.{" "}
                    {contactsQuery.data?.filter((contact) => contact.optedOut)
                      .length ?? 0}{" "}
                    so far.
                  </span>
                </div>
                <a href="/leads?whatsapp=opted-out">View opted out</a>
              </div>
            </div>
          </SettingsOptionGroup>

          <section className="c3wa-templates-section" id="wa-templates">
            <header className="c3wa-templates-head">
              <div>
                <h2>Templates</h2>
                <p>
                  Approved by Meta. A first message always uses one of these.
                  Rename any of them so they’re easy to tell apart.
                </p>
              </div>
              {canManage ? (
                <Button
                  disabled={busy || templatesQuery.isFetching}
                  onClick={() => void syncTemplates()}
                  type="button"
                  variant="outline"
                >
                  {templatesQuery.isFetching ? "Syncing…" : "Sync from Meta"}
                </Button>
              ) : null}
            </header>
            <div className="c3wa-templates">
              {TEMPLATE_GROUPS.map((group) => {
                const grouped = orderedTemplates.filter(
                  (template) => templateGroup(template) === group,
                );
                if (!grouped.length) return null;
                return (
                  <section
                    aria-label={`${group} templates`}
                    className="c3wa-template-group"
                    key={group}
                  >
                    <h3>
                      {group}
                      <span> · {grouped.length}</span>
                    </h3>
                    <SettingsOptionGroup className="c3wa-group c3wa-template-group-card">
                      {grouped.map((template) => (
                        <TemplateRow
                          canManage={canManage}
                          key={`${template.name}:${template.language}`}
                          onRename={renameTemplate}
                          template={template}
                        />
                      ))}
                    </SettingsOptionGroup>
                  </section>
                );
              })}
              {templates.length === 0 ? (
                <p className="c3wa-empty">
                  No templates were returned by Meta.
                </p>
              ) : null}
            </div>
            <p className="c3wa-free-text-note">
              Free text goes out only within 24 hours of a contact’s last
              message.
            </p>
          </section>

          <div className="c3wa-disconnect-row">
            <div>
              <strong>Disconnect WhatsApp</strong>
              <span>
                Agents stop sending at once. Chats and leads stay in Colony.
              </span>
            </div>
            {confirmDisconnect ? (
              <span>Disconnect this number? Chat history stays in Colony.</span>
            ) : null}
            {confirmDisconnect ? (
              <Button
                disabled={busy}
                onClick={() => setConfirmDisconnect(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            ) : null}
            <Button
              className="c3wa-disconnect"
              disabled={!canManage || busy}
              data-testid="whatsapp-disconnect"
              onClick={() => void disconnect()}
              type="button"
              variant="outline"
            >
              {confirmDisconnect ? "Confirm disconnect" : "Disconnect"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
