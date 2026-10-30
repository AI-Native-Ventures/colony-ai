import { useEffect, useRef, useState } from "react";

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
}: {
  model: CofounderOnboardingModel;
  onConfirmBrief: () => void;
  onCorrectBrief: (changes: CofounderBusinessBrief) => void;
  onChooseMoney: (preference: MoneyPreference) => void;
  onSaveApprovalSwitches: (switches: ApprovalSwitches) => void;
  onOpenAccount: (url: string, channelId: string) => void;
  onAccountConnected: () => void;
  onApproveMap: () => void;
  onChangeMap: () => void;
}) {
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState(model.brief);
  const [switches, setSwitches] = useState(model.approvalSwitches);
  const firstBriefInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingBrief) firstBriefInputRef.current?.focus();
  }, [editingBrief]);
  const stepOrder = [
    "brief",
    "money",
    "approvals",
    "account",
    "map",
    "complete",
  ];
  const currentStepIndex = stepOrder.indexOf(model.step);
  const hasReached = (step: string) =>
    currentStepIndex >= stepOrder.indexOf(step);

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
          Here’s what I know about {model.brief.companyName}
        </h2>
        {editingBrief ? (
          <div className="cf2-brief-edit-grid">
            {(
              [
                ["companyName", "Company name"],
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
                  onChange={(event) =>
                    setBriefDraft((current) => ({
                      ...current,
                      [field]: event.currentTarget.value,
                    }))
                  }
                  value={briefDraft[field]}
                />
              </label>
            ))}
          </div>
        ) : (
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
              {model.brief.priceNote ? (
                <span className="cf2-price-note">{model.brief.priceNote}</span>
              ) : null}
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
        )}
        {model.step === "brief" ? (
          <div className="cf2-actions">
            {editingBrief ? (
              <>
                <button
                  className="cf2-button cf2-button-primary"
                  data-testid="cofounder-brief-save"
                  onClick={() => {
                    onCorrectBrief(briefDraft);
                    setEditingBrief(false);
                  }}
                  type="button"
                >
                  Save brief
                </button>
                <button
                  className="cf2-button"
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
                  onClick={onConfirmBrief}
                  type="button"
                >
                  Confirm
                </button>
                <button
                  className="cf2-button"
                  data-testid="cofounder-brief-correct"
                  onClick={() => setEditingBrief(true)}
                  type="button"
                >
                  Correct
                </button>
              </>
            )}
          </div>
        ) : (
          <p className="cf2-completed-note" role="status">
            {model.step === "complete"
              ? "Brief confirmed"
              : "You confirmed this brief"}
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
          <fieldset aria-label="Money preference" className="cf2-choice-grid">
            <button
              aria-pressed={model.moneyPreference === "cheapest_first"}
              className="cf2-choice"
              data-testid="cofounder-money-cheapest"
              disabled={model.step !== "money"}
              onClick={() => onChooseMoney("cheapest_first")}
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
              disabled={model.step !== "money"}
              onClick={() => onChooseMoney("best_option")}
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
                  disabled={model.step !== "approvals"}
                  onChange={(event) =>
                    setSwitches((current) => ({
                      ...current,
                      [field.key]: event.currentTarget.checked,
                    }))
                  }
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
                onClick={() => onSaveApprovalSwitches(switches)}
                type="button"
              >
                Save
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
            Connect {model.accountName} for design ideas
          </h2>
          <div className="cf2-browser-ready">
            <span aria-hidden="true" className="cf2-browser-glyph">
              ◎
            </span>
            <span>
              <strong>
                {model.accountName.toLowerCase()} login is open in the browser
              </strong>
              <small>Free. I only browse boards for ideas, never post.</small>
            </span>
            <span className="cf2-chip cf2-chip-warm">
              {model.accountConnected ? "Connected" : "Waiting for you"}
            </span>
          </div>
          <div className="cf2-actions">
            <button
              className="cf2-button"
              data-testid="cofounder-account-open-browser"
              disabled={model.step !== "account"}
              onClick={() =>
                onOpenAccount(model.accountUrl, model.accountChannelId)
              }
              type="button"
            >
              Open browser
            </button>
            <button
              className="cf2-button cf2-button-primary"
              data-testid="cofounder-account-connected"
              disabled={model.step !== "account"}
              onClick={onAccountConnected}
              type="button"
            >
              I’m logged in
            </button>
          </div>
        </section>
      ) : null}

      {hasReached("map") ? (
        <section
          aria-labelledby="cf2-map-title"
          className="cf2-card cf2-onboarding-card"
        >
          <div className="cf2-chip-row">
            <span className="cf2-chip cf2-chip-warm">Needs you</span>
            <span className="cf2-chip">Company map</span>
          </div>
          <h2 id="cf2-map-title">
            The company I suggest for {model.brief.companyName}
          </h2>
          <p className="cf2-onboarding-copy">
            Scout is Chief of Staff and runs the company with you. We fill one
            slot at a time, starting with Sales.
          </p>
          <ol className="cf2-function-list">
            {FUNCTION_ORDER.map((functionId, index) => (
              <li key={functionId}>
                <span className="cf2-function-index">{index + 1}</span>
                <strong>{FUNCTION_LABELS[functionId]}</strong>
                <span className="cf2-muted">
                  {index === 0
                    ? "Aya moves here"
                    : index === 1
                      ? "I cover it for now"
                      : "Empty"}
                </span>
                <span className="cf2-chip">
                  {index === 0 ? "Fill first" : index === 1 ? "Next" : "Later"}
                </span>
              </li>
            ))}
          </ol>
          <div className="cf2-actions">
            <button
              className="cf2-button cf2-button-primary"
              data-testid="cofounder-map-approve"
              disabled={model.step !== "map"}
              onClick={onApproveMap}
              type="button"
            >
              Approve the map
            </button>
            <button
              className="cf2-button"
              data-testid="cofounder-map-change"
              disabled={model.step !== "map"}
              onClick={onChangeMap}
              type="button"
            >
              Change it
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
