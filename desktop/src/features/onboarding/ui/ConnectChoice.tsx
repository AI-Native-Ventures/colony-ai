import * as React from "react";

import { FirstRunButton, FirstRunError } from "./firstRunControls";
import { FirstRunHead } from "./FirstRunFrame";
import { CheckIcon, TerminalIcon } from "./firstRunIcons";
import type { OnboardingSceneData } from "./OnboardingSceneTypes";

/** The three ways to run Scout, as radio cards in one group. */
export type ConnectChoiceId = "own" | "colony" | "free";

export function ConnectChoices({ children }: { children: React.ReactNode }) {
  return (
    <div aria-label="AI connection" className="c3fr-choices" role="radiogroup">
      <span className="c3fr-label c3fr-choices-legend">
        How should Scout and your agents run?
      </span>
      {children}
    </div>
  );
}

/** One radio card. The head is the label; the body holds its own controls. */
export function ConnectCard({
  id,
  title,
  description,
  selected,
  onSelect,
  disabled,
  tight,
  chips,
  children,
  testId,
}: {
  id: ConnectChoiceId;
  title: string;
  description: string;
  selected: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  /** Title and description sit 4px apart (the card has a body below). */
  tight?: boolean;
  chips?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}) {
  const titleId = `c3fr-choice-${id}-title`;
  const descriptionId = `c3fr-choice-${id}-description`;
  return (
    <div
      className="c3fr-choice"
      data-selected={selected ? "true" : undefined}
      data-testid={testId ?? `onboarding-choice-${id}`}
    >
      <label className="c3fr-choice-head">
        <input
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          checked={selected}
          data-testid={`onboarding-mode-${id}`}
          disabled={disabled}
          name="c3fr-ai"
          onChange={onSelect}
          type="radio"
        />
        <span
          className="c3fr-choice-copy"
          data-tight={tight ? "true" : undefined}
        >
          <span className="c3fr-choice-title" id={titleId}>
            {title}
          </span>
          <span className="c3fr-choice-desc" id={descriptionId}>
            {description}
          </span>
          {chips ? <span className="c3fr-chips">{chips}</span> : null}
        </span>
      </label>
      {children}
    </div>
  );
}

export function ConnectChip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "need";
}) {
  return (
    <span className="c3fr-pill" data-tone={tone}>
      {tone === "ok" ? <CheckIcon size={11} strokeWidth={3.2} /> : null}
      {children}
    </span>
  );
}

/** Claude Code and Codex, side by side in the grey box. */
export function RuntimeBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="c3fr-runtimes" id="onboarding-runtime-list">
      {children}
    </div>
  );
}

export function RuntimeRow({
  id,
  name,
  ready,
  status,
  statusTone,
  allowance,
  action,
  selected,
  choosable,
  onSelect,
}: {
  id: string;
  name: string;
  /** Ready to test: the dark tile and, when it has one, the allowance. */
  ready: boolean;
  status: string;
  statusTone?: "ok" | "need";
  allowance?: React.ReactNode;
  action?: React.ReactNode;
  selected?: boolean;
  /** More than one app could run Scout, so the rows can be chosen between. */
  choosable?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="c3fr-runtime-icon"
        data-ready={ready ? "true" : undefined}
      >
        <TerminalIcon size={19} strokeWidth={2.2} />
      </span>
      <span
        className="c3fr-runtime-main"
        data-stacked={allowance ? "true" : undefined}
      >
        <span className="c3fr-runtime-line">
          <span className="c3fr-runtime-name">{name}</span>
          <ConnectChip tone={statusTone}>{status}</ConnectChip>
        </span>
        {allowance}
      </span>
    </>
  );
  return (
    <div
      className="c3fr-runtime"
      data-choosable={choosable ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-testid={`onboarding-connect-runtime-${id}`}
    >
      {choosable ? (
        <button
          aria-pressed={selected}
          className="c3fr-runtime-select"
          onClick={onSelect}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="c3fr-runtime-select">{body}</div>
      )}
      {action}
    </div>
  );
}

/** The weekly allowance meter. Missing windows never turn into made-up numbers. */
export function AllowanceMeter({
  percent,
  label = "Weekly allowance",
}: {
  percent: number;
  label?: string;
}) {
  return (
    <span className="c3fr-meter-line">
      <span className="c3fr-meter-label">{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: the board's thin meter bar needs a styled span. */}
      <span
        aria-label={`${label} remaining`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="c3fr-meter"
        role="meter"
      >
        <span style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

export function ConnectNotice({
  children,
  tone,
  testId,
}: {
  children: React.ReactNode;
  tone?: "error";
  testId?: string;
}) {
  return tone === "error" ? (
    <div data-testid={testId}>
      <FirstRunError>{children}</FirstRunError>
    </div>
  ) : (
    <p className="c3fr-note" data-testid={testId} role="status">
      {children}
    </p>
  );
}

/** The Connect screen as the board draws it: sample state for visual scenes. */
export function ConnectChoice(_props: { data: OnboardingSceneData }) {
  const [choice, setChoice] = React.useState<ConnectChoiceId>("own");
  return (
    <form
      className="c3fr-form"
      onSubmit={(event) => event.preventDefault()}
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <FirstRunHead
        lede="Your AI. Your models. Your way."
        title="Connect your AI."
      />
      <ConnectChoices>
        <ConnectCard
          description="Use a coding agent you already have on this Mac."
          id="own"
          onSelect={() => setChoice("own")}
          selected={choice === "own"}
          tight
          title="Claude Code or Codex"
        >
          <RuntimeBox>
            <RuntimeRow
              allowance={<AllowanceMeter percent={70} />}
              id="claude"
              name="Claude Code"
              ready
              status="Installed · signed in"
              statusTone="ok"
            />
            <RuntimeRow
              action={
                <FirstRunButton size="small" className="c3fr-runtime-action">
                  Install
                </FirstRunButton>
              }
              id="codex"
              name="Codex"
              ready={false}
              status="Not installed"
            />
          </RuntimeBox>
        </ConnectCard>
        <ConnectCard
          chips={
            <>
              <ConnectChip>OpenRouter</ConnectChip>
              <ConnectChip>Colony credits · Coming soon</ConnectChip>
            </>
          }
          description="Runs inside Colony. Bring an OpenRouter key, or pay as you go with Colony credits."
          id="colony"
          onSelect={() => setChoice("colony")}
          selected={choice === "colony"}
          title="Colony Agent"
        />
        <ConnectCard
          description="Free AI on your computer. No account, no card."
          id="free"
          onSelect={() => setChoice("free")}
          selected={choice === "free"}
          title="Start free"
        />
      </ConnectChoices>
      <div className="c3fr-actions">
        <FirstRunButton>Back</FirstRunButton>
        <FirstRunButton kind="primary" type="submit">
          Test the connection
        </FirstRunButton>
      </div>
    </form>
  );
}
