import { useEffect, useRef, useState } from "react";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { FUNCTION_ORDER } from "../functions";
import type {
  CofounderBusinessBrief,
  CofounderOnboardingModel,
} from "../cofounderPhase2Model";
import type { ApprovalSwitches, MoneyPreference } from "../cofounderRecords";
import "./cofounderPhase2.css";

const FUNCTION_LABELS: Record<(typeof FUNCTION_ORDER)[number], string> = {
  sales: "Sales",
  operations: "Operations",
  customer_success: "Customer Success",
  finance: "Finance",
  brand: "Brand",
};

const APPROVAL_FIELDS: Array<{
  key: keyof ApprovalSwitches;
  title: string;
  description: string;
}> = [
  {
    key: "approveEveryHire",
    title: "Approve every hire",
    description: "I propose the role; you say yes before they join.",
  },
  {
    key: "approvePlaybookChanges",
    title: "Approve playbook changes",
    description: "How the work gets done changes only with your OK.",
  },
  {
    key: "approveEveryDiscoveryCampaign",
    title: "Approve every Discovery campaign",
    description: "Searches for new leads run without asking when this is off.",
  },
];

const STEP_ORDER = ["brief", "money", "approvals", "account", "map"] as const;

export function CofounderOnboardingFlow({
  model,
  onConfirmBrief,
  onCorrectBrief,
  onChooseMoney,
  onSaveApprovalSwitches,
  onOpenAccount,
  onAccountConnected,
  onApproveMap,
  onChangeMap,
  onComplete,
}: {
  model: CofounderOnboardingModel;
  onConfirmBrief: () => void | Promise<void>;
  onCorrectBrief: (changes: CofounderBusinessBrief) => void | Promise<void>;
  onChooseMoney: (preference: MoneyPreference) => void | Promise<void>;
  onSaveApprovalSwitches: (switches: ApprovalSwitches) => void | Promise<void>;
  onOpenAccount: (url: string, channelId: string) => void | Promise<void>;
  onAccountConnected: () => void | Promise<void>;
  onApproveMap: () => void | Promise<void>;
  onChangeMap: () => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}) {
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState<CofounderBusinessBrief | null>(
    model.brief,
  );
  const [switches, setSwitches] = useState(model.approvalSwitches);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const firstBriefInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingBrief) firstBriefInputRef.current?.focus();
  }, [editingBrief]);
  useEffect(() => {
    if (!editingBrief) setBriefDraft(model.brief);
  }, [editingBrief, model.brief]);
  useEffect(
    () => setSwitches(model.approvalSwitches),
    [model.approvalSwitches],
  );

  const visibleStepIndex = STEP_ORDER.indexOf(model.visibleThrough);
  const hasReached = (step: (typeof STEP_ORDER)[number]) =>
    visibleStepIndex >= STEP_ORDER.indexOf(step);
  const leadPubkeys = (model.map?.entries ?? []).flatMap((entry) =>
    entry.leadPubkey ? [entry.leadPubkey] : [],
  );
  const profiles = useUsersBatchQuery(leadPubkeys, {
    enabled: leadPubkeys.length > 0,
  });
  const actionDisabled = pendingAction !== null;

  async function runAction(action: string, run: () => void | Promise<void>) {
    setPendingAction(action);
    setActionError(null);
    try {
      await run();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not save onboarding.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  function mapEntryLabel(functionId: (typeof FUNCTION_ORDER)[number]) {
    const entry = model.map?.entries.find(
      (candidate) => candidate.function === functionId,
    );
    if (!entry) return "Not assigned";
    if (entry.placement === "scout") return "Covered by Scout";
    if (entry.placement === "empty") return "Empty";
    const name = entry.leadPubkey
      ? profiles.data?.profiles[
          entry.leadPubkey.toLowerCase()
        ]?.displayName?.trim()
      : null;
    return name ? `${name} moves here` : "Existing agent";
  }

  return (
    <section
      aria-label="Co-founder onboarding with Scout"
      className="cf2-onboarding"
      data-testid="cofounder-onboarding"
    >
      <p className="cf2-chat-intro">
        Co-founder mode is on. I read what Colony already knows. Check this
        before I plan anything.
      </p>

      <section
        aria-labelledby="cf2-brief-title"
        className="cf2-card cf2-onboarding-card"
      >
        <div className="cf2-chip-row">
          <span className="cf2-chip">Business brief</span>
          <span className="cf2-muted">Stays editable under Company</span>
        </div>
        <h2 id="cf2-brief-title">
          Here’s what I know about {model.brief?.companyName ?? "your company"}
        </h2>
        {editingBrief && briefDraft ? (
          <div className="cf2-brief-edit-grid">
            {(
              [
                ["whatYouSell", "What you sell"],
                ["whoBuys", "Who buys"],
                ["prices", "Prices"],
                ["howYouTalk", "How you talk"],
              ] as const
            ).map(([field, label], index) => (
              <label className="cf2-edit-field" key={field}>
                {label}
                <input
                  ref={index === 0 ? firstBriefInputRef : undefined}
                  data-testid={`cofounder-brief-${field}`}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setBriefDraft((current) =>
                      current ? { ...current, [field]: value } : current,
                    );
                  }}
                  value={briefDraft[field]}
                />
              </label>
            ))}
          </div>
        ) : model.brief ? (
          <dl className="cf2-brief-list">
            <dt>What you sell</dt>
            <dd>{model.brief.whatYouSell}</dd>
            <dt>Who buys</dt>
            <dd>{model.brief.whoBuys}</dd>
            <dt>Prices</dt>
            <dd>
              {model.brief.prices || (
                <span className="cf2-chip cf2-chip-warm">Not found</span>
              )}
            </dd>
            <dt>How you talk</dt>
            <dd>{model.brief.howYouTalk}</dd>
            <dt>What I read</dt>
            <dd className="cf2-source-list">
              {model.brief.sources.map((source) => (
                <span className="cf2-chip" key={source}>
                  {source}
                </span>
              ))}
            </dd>
          </dl>
        ) : (
          <p className="cf2-empty-note" role="status">
            Scout is preparing the business brief.
          </p>
        )}
        {model.step === "brief" && model.questionText ? (
          <p className="cf2-onboarding-copy">{model.questionText}</p>
        ) : null}
        {model.step === "brief" ? (
          <div className="cf2-actions">
            {editingBrief && briefDraft ? (
              <>
                <button
                  className="cf2-button cf2-button-primary"
                  data-testid="cofounder-brief-save"
                  disabled={actionDisabled}
                  onClick={() =>
                    void runAction("brief-edit", async () => {
                      await onCorrectBrief(briefDraft);
                      setEditingBrief(false);
                    })
                  }
                  type="button"
                >
                  {pendingAction === "brief-edit" ? "Saving…" : "Save brief"}
                </button>
                <button
                  className="cf2-button"
                  disabled={actionDisabled}
                  onClick={() => {
                    setBriefDraft(model.brief);
                    setEditingBrief(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="cf2-button cf2-button-primary"
                  data-testid="cofounder-brief-confirm"
                  disabled={actionDisabled || !model.brief}
                  onClick={() =>
                    void runAction("brief-confirm", onConfirmBrief)
                  }
                  type="button"
                >
                  {pendingAction === "brief-confirm"
                    ? "Saving…"
                    : model.briefConfirmed && !model.briefPending
                      ? "Continue"
                      : "Confirm"}
                </button>
                <button
                  className="cf2-button"
                  disabled={actionDisabled || !model.brief}
                  onClick={() => {
                    setBriefDraft(model.brief);
                    setEditingBrief(true);
                  }}
                  type="button"
                >
                  Correct
                </button>
              </>
            )}
          </div>
        ) : (
          <p className="cf2-completed-note" role="status">
            {model.briefConfirmed
              ? "You confirmed this brief"
              : "This brief is waiting for Scout"}
          </p>
        )}
      </section>

      {hasReached("money") ? (
        <section
          aria-labelledby="cf2-money-title"
          className="cf2-card cf2-onboarding-card"
        >
          <p className="cf2-question-count">Question 1 of 3</p>
          <h2 id="cf2-money-title">How should I spend money?</h2>
          {model.step === "money" && model.questionText ? (
            <p className="cf2-onboarding-copy">{model.questionText}</p>
          ) : null}
          <fieldset aria-label="Money preference" className="cf2-choice-grid">
            <button
              aria-pressed={model.moneyPreference === "cheapest_first"}
              className="cf2-choice"
              data-testid="cofounder-money-cheapest"
              disabled={model.step !== "money" || actionDisabled}
              onClick={() =>
                void runAction("money", () => onChooseMoney("cheapest_first"))
              }
              type="button"
            >
              <strong>Cheapest first</strong>
              {model.moneyPreference === "cheapest_first" ? (
                <span className="cf2-recommended">Recommended</span>
              ) : null}
              <span>
                Free where possible, then the cheapest tool that works.
              </span>
            </button>
            <button
              aria-pressed={model.moneyPreference === "best_option"}
              className="cf2-choice"
              data-testid="cofounder-money-best"
              disabled={model.step !== "money" || actionDisabled}
              onClick={() =>
                void runAction("money", () => onChooseMoney("best_option"))
              }
              type="button"
            >
              <strong>Best option</strong>
              <span>The best tool for the job, even if it costs more.</span>
            </button>
          </fieldset>
          <p className="cf2-help">
            Either way, I ask you before anything costs money. You can change
            this later in Company.
          </p>
        </section>
      ) : null}

      {hasReached("approvals") ? (
        <section
          aria-labelledby="cf2-approvals-title"
          className="cf2-card cf2-onboarding-card"
        >
          <p className="cf2-question-count">Question 2 of 3</p>
          <h2 id="cf2-approvals-title">What else should wait for your OK?</h2>
          {model.step === "approvals" && model.questionText ? (
            <p className="cf2-onboarding-copy">{model.questionText}</p>
          ) : null}
          <p className="cf2-onboarding-copy">
            Outreach, spending and anything with your brand on it always wait.
            Every follow-up message an agent writes is a draft for you.
          </p>
          <div className="cf2-switch-list">
            {APPROVAL_FIELDS.map((field) => (
              <label className="cf2-switch-row" key={field.key}>
                <span>
                  <strong>{field.title}</strong>
                  <small>{field.description}</small>
                </span>
                <input
                  aria-label={field.title}
                  aria-checked={switches[field.key]}
                  checked={switches[field.key]}
                  data-testid={`cofounder-approval-${field.key}`}
                  disabled={model.step !== "approvals" || actionDisabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSwitches((current) => ({
                      ...current,
                      [field.key]: checked,
                    }));
                  }}
                  role="switch"
                  type="checkbox"
                />
              </label>
            ))}
          </div>
          {model.step === "approvals" ? (
            <div className="cf2-actions">
              <button
                className="cf2-button cf2-button-primary"
                data-testid="cofounder-approval-save"
                disabled={actionDisabled}
                onClick={() =>
                  void runAction("approvals", () =>
                    onSaveApprovalSwitches(switches),
                  )
                }
                type="button"
              >
                {pendingAction === "approvals" ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <p className="cf2-completed-note" role="status">
              Approval preferences saved
            </p>
          )}
        </section>
      ) : null}

      {hasReached("account") ? (
        <section
          aria-labelledby="cf2-account-title"
          className="cf2-card cf2-onboarding-card"
        >
          <p className="cf2-question-count">Question 3 of 3</p>
          <h2 id="cf2-account-title">
            {model.accountName
              ? `Connect ${model.accountName} for your company`
              : "Account setup"}
          </h2>
          {model.accountName ? (
            <div className="cf2-browser-ready">
              <span aria-hidden="true" className="cf2-browser-glyph">
                ◎
              </span>
              <span>
                <strong>
                  {model.accountName.toLowerCase()} login is open in the browser
                </strong>
                <small>
                  Complete the login yourself in the built-in browser.
                </small>
              </span>
              <span className="cf2-chip cf2-chip-warm">
                {model.accountConnected ? "Connected" : "Waiting for you"}
              </span>
            </div>
          ) : (
            <p className="cf2-empty-note" role="status">
              No account connection is waiting.
            </p>
          )}
          {model.step === "account" && model.questionText ? (
            <p className="cf2-onboarding-copy">{model.questionText}</p>
          ) : null}
          <div className="cf2-actions">
            {model.accountUrl ? (
              <button
                className="cf2-button"
                data-testid="cofounder-account-open-browser"
                disabled={model.step !== "account" || actionDisabled}
                onClick={() =>
                  void runAction("account-browser", () =>
                    onOpenAccount(
                      model.accountUrl ?? "",
                      model.accountChannelId,
                    ),
                  )
                }
                type="button"
              >
                {pendingAction === "account-browser"
                  ? "Opening…"
                  : "Open browser"}
              </button>
            ) : null}
            {model.accountName ? (
              <button
                className="cf2-button cf2-button-primary"
                data-testid="cofounder-account-connected"
                disabled={model.step !== "account" || actionDisabled}
                onClick={() =>
                  void runAction("account-answer", onAccountConnected)
                }
                type="button"
              >
                {pendingAction === "account-answer"
                  ? "Saving…"
                  : "I’m logged in"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {hasReached("map") && model.map ? (
        <section
          aria-labelledby="cf2-map-title"
          className="cf2-card cf2-onboarding-card"
        >
          <div className="cf2-chip-row">
            <span className="cf2-chip cf2-chip-warm">Needs you</span>
            <span className="cf2-chip">Company map</span>
          </div>
          <h2 id="cf2-map-title">
            The company I suggest for{" "}
            {model.brief?.companyName ?? "your company"}
          </h2>
          <p className="cf2-onboarding-copy">
            Scout is Chief of Staff and runs the company with you. We fill one
            slot at a time, starting where the map recommends.
          </p>
          <ol className="cf2-function-list">
            {FUNCTION_ORDER.map((functionId, index) => (
              <li key={functionId}>
                <span className="cf2-function-index">{index + 1}</span>
                <strong>{FUNCTION_LABELS[functionId]}</strong>
                <span className="cf2-muted">{mapEntryLabel(functionId)}</span>
                <span className="cf2-chip">
                  {functionId === model.map?.firstFunction
                    ? "Fill first"
                    : "Later"}
                </span>
              </li>
            ))}
          </ol>
          <div className="cf2-actions">
            <button
              className="cf2-button cf2-button-primary"
              data-testid="cofounder-map-approve"
              disabled={model.step !== "map" || actionDisabled}
              onClick={() =>
                void runAction(
                  model.map?.approved ? "complete" : "map-approve",
                  model.map?.approved ? onComplete : onApproveMap,
                )
              }
              type="button"
            >
              {pendingAction === "complete"
                ? "Finishing…"
                : pendingAction === "map-approve"
                  ? "Saving…"
                  : model.map.approved
                    ? "Finish onboarding"
                    : "Approve the map"}
            </button>
            <button
              className="cf2-button"
              data-testid="cofounder-map-change"
              disabled={
                model.step !== "map" || actionDisabled || model.map.approved
              }
              onClick={() => void runAction("map-reject", onChangeMap)}
              type="button"
            >
              Change it
            </button>
          </div>
        </section>
      ) : null}

      {model.step === "waiting" ? (
        <p className="cf2-empty-note" role="status">
          Waiting for Scout to ask the next question.
        </p>
      ) : null}
      {actionError ? (
        <p className="cf2-error-note" role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
