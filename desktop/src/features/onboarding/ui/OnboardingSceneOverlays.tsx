import * as React from "react";
import { createPortal } from "react-dom";
import type { OnboardingSceneId } from "./onboardingScenes";
import type {
  OnboardingSceneData,
  PresentationProps,
} from "./OnboardingSceneTypes";
import {
  BackButton,
  Brand,
  Glyph,
  PrimaryButton,
} from "./OnboardingScenePrimitives";

function HistoryDialog({ review = false }: { review?: boolean }) {
  return (
    <ReferenceDialog>
      {!review ? (
        <div className="status-icon">
          <Glyph name="history" />
        </div>
      ) : null}
      <h2 id="onboarding-reference-dialog-title" tabIndex={-1}>
        {review ? "Keep what’s useful." : "Bring your context with you."}
      </h2>
      <p className="lede">
        {review
          ? "Edit or uncheck anything that doesn’t belong."
          : "Turn useful details from past AI conversations into memories for your Colony. You choose what to keep."}
      </p>
      {review ? (
        <div className="memory-list">
          {[
            ["I run a small homeware studio in Johannesburg.", "Claude Code"],
            [
              "I prefer warm, straightforward copy without sales jargon.",
              "Claude Code",
            ],
            ["I’m preparing a spring collection launch.", "Codex"],
          ].map(([item, source]) => (
            <label className="memory-row" key={item}>
              <input aria-label="Keep memory" defaultChecked type="checkbox" />
              <span>
                <textarea aria-label="Memory" defaultValue={item} />
                <small>{source} · Sample conversation</small>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {review ? (
        <div className="modal-actions">
          <button className="link" type="button">
            Skip for now
          </button>
          <button className="primary" type="button">
            Save memories <Glyph name="check" />
          </button>
        </div>
      ) : (
        <>
          <button className="primary full" type="button">
            Find my history <Glyph name="arrow" />
          </button>
          <button className="back" type="button">
            Choose a conversation export
          </button>
          <p className="hint">
            Nothing is imported until you review and save it.
          </p>
        </>
      )}
    </ReferenceDialog>
  );
}

function ReferenceDialog({ children }: { children: React.ReactNode }) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <div className="colony-onboarding-root">
      <dialog
        aria-labelledby="onboarding-reference-dialog-title"
        className="onboarding-reference-dialog"
        id="onboarding-reference-dialog"
        ref={dialogRef}
      >
        <div className="modal">
          <button
            aria-label="Close dialog"
            className="icon-button close"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <Glyph name="x" />
          </button>
          {children}
        </div>
      </dialog>
    </div>,
    document.body,
  );
}

export function CreditReviewDialog({ data }: { data: OnboardingSceneData }) {
  return (
    <ReferenceDialog>
      <h2 id="onboarding-reference-dialog-title" tabIndex={-1}>
        Review your top-up.
      </h2>
      <p className="lede">A one-off purchase for {data.business}.</p>
      <dl className="purchase-summary">
        <div>
          <dt>Colony credits</dt>
          <dd>$5.00</dd>
        </div>
        <div>
          <dt>Receipt to</dt>
          <dd>{data.email}</dd>
        </div>
        <div className="total">
          <dt>You pay</dt>
          <dd>
            R99.00 <small>ZAR</small>
          </dd>
        </div>
      </dl>
      <p className="power-caption">No recurring charge or automatic top-up.</p>
      <button className="primary full" type="button">
        Continue to checkout <Glyph name="arrow" />
      </button>
      <button
        className="back"
        onClick={() =>
          (
            document.getElementById(
              "onboarding-reference-dialog",
            ) as HTMLDialogElement | null
          )?.close()
        }
        type="button"
      >
        Change amount
      </button>
    </ReferenceDialog>
  );
}

export function WorkspacePreview({
  data,
  scene,
}: {
  data: OnboardingSceneData;
  scene: OnboardingSceneId;
}) {
  const history = scene === "history" || scene === "history-review";
  return (
    <>
      <section className="workspace">
        <div className="windowbar">
          <span className="traffic">
            <i />
            <i />
            <i />
          </span>
          <span>{data.business}</span>
        </div>
        <aside className="sidebar">
          <Brand />
          <button className="business-switch" type="button">
            <span className="business-initial">
              {data.business.slice(0, 1) || "L"}
            </span>
            <strong>{data.business || "Lerato Studio"}</strong>
            <Glyph name="down" />
          </button>
          <nav aria-label="Workspace">
            <button
              aria-current="page"
              className="side-item active"
              type="button"
            >
              <Glyph name="home" />
              Today
            </button>
            <button className="side-item" type="button">
              <Glyph name="team" />
              Your team
            </button>
            <button className="side-item" type="button">
              <Glyph name="chat" />
              Conversations
            </button>
            <button className="side-item" type="button">
              <Glyph name="folder" />
              Files &amp; knowledge
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button className="import-link" type="button">
              <Glyph name="history" />
              Bring your AI history
            </button>
            <div className="profile">
              <span className="initials">LM</span>
              {data.name || "Lerato Molefe"}
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="workspace-top">
            <span>Today</span>
            <span>
              <Glyph name="check" />
              Your Colony is ready
            </span>
          </header>
          <div className="arrival">
            <h1>You’re in, {data.name.trim().split(" ")[0] || "Lerato"}.</h1>
            <p className="lede">
              A good place to start is one small piece of work.
            </p>
            <div className="greeting-agent">
              <span className="agent-avatar" />
              <strong>Scout</strong>
              <span>Your AI teammate</span>
            </div>
            <p className="welcome-message">
              I can help you plan, write and keep track of the work that moves
              your business forward.
            </p>
            <div className="suggestions">
              <button className="suggestion" type="button">
                <Glyph name="sparkles" />
                Plan my next launch
              </button>
              <button className="suggestion" type="button">
                <Glyph name="document" />
                Draft something for my business
              </button>
            </div>
            <div className="composer">
              <textarea
                aria-label="Message Scout"
                placeholder="What would you like to work on?"
              />
              <div className="composer-bottom">
                <span>Your team works with you here.</span>
                <button className="send-button" type="button">
                  <Glyph name="send" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      {history ? <HistoryDialog review={scene === "history-review"} /> : null}
    </>
  );
}

export function ConnectedScene({
  data,
  onNavigate,
  focusTitle = false,
}: Pick<PresentationProps, "data" | "onNavigate"> & {
  focusTitle?: boolean;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (focusTitle) headingRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);

  return (
    <>
      <div className="agent-avatar large" />
      <h2 ref={headingRef} tabIndex={-1}>
        That’s a good start.
      </h2>
      <p className="lede">Your agent is connected and ready to work.</p>
      <div className="reply">
        <div className="reply-header">
          <span className="agent-avatar" />
          <strong>Scout</strong>
          <span>
            <Glyph name="check" />
            Replied
          </span>
        </div>
        <p>
          Hello {data.name.trim().split(" ")[0] || "Lerato"}, I’m here.
          <br />
          What shall we work on first?
        </p>
      </div>
      <div className="connection-meta">
        <span>Claude Code subscription</span>
        <span>
          <i className="status-dot" />
          Connection verified
        </span>
      </div>
      <PrimaryButton onClick={() => onNavigate?.("workspace")}>
        Open my Colony
      </PrimaryButton>
      <BackButton onClick={() => onNavigate?.("connect")}>
        Change connection
      </BackButton>
    </>
  );
}
