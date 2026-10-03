import * as React from "react";
import { ScoutAvatar } from "./ScoutAvatar";
import { createPortal } from "react-dom";
import type {
  OnboardingSceneData,
  PresentationProps,
} from "./OnboardingSceneTypes";
import { BackButton, Glyph, PrimaryButton } from "./OnboardingScenePrimitives";

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
      <ScoutAvatar className="agent-avatar large scout-rendered" pose="done" />
      <h2 ref={headingRef} tabIndex={-1}>
        That’s a good start.
      </h2>
      <p className="lede">Your agent is connected and ready to work.</p>
      <div className="reply">
        <div className="reply-header">
          <ScoutAvatar className="agent-avatar scout-rendered" />
          <strong>Scout</strong>
          <span>
            <Glyph name="check" />
            Replied
          </span>
        </div>
        <p className="whitespace-pre-wrap max-h-64 overflow-y-auto">
          {data.connectionReply ??
            data.firstReply ??
            (data.visualOnly
              ? `Hello ${data.name.trim().split(" ")[0] || "Lerato"}, I’m here.\nWhat shall we work on first?`
              : "")}
        </p>
      </div>
      <div className="connection-meta">
        <span>
          {data.connectionLabel ??
            (data.visualOnly
              ? "Claude Code · Sonnet"
              : `${data.harnessLabel ?? "Selected harness"} · ${data.effectiveModel ?? "Model not reported"}`)}
        </span>
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
