import type * as React from "react";

import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { FirstRunFrame, type FirstRunStory } from "./FirstRunFrame";
import { ShieldIcon } from "./firstRunIcons";

const STORY: FirstRunStory = {
  heading: "We can sort this out.",
  body: "Your next step is shown alongside me. You can retry or use another option.",
  status: "Needs your attention",
  tone: "turn",
  pose: "waiting",
  footer: (
    <span className="c3fr-story-reassure">
      <ShieldIcon size={18} />
      Nothing you’ve made is lost while Colony recovers.
    </span>
  ),
};

/**
 * One calm screen for one startup problem: Scout on the left, one card with a
 * clear way forward on the right.
 */
export function StartupProblem({
  testId,
  icon,
  tone,
  title,
  body,
  details,
  actions,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  tone: "bad" | "accent" | "need" | "muted";
  title: string;
  body: React.ReactNode;
  /** The raw error, behind a "Technical details" disclosure. */
  details?: string | null;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <StartupWindowDragRegion />
      <FirstRunFrame
        layout="startup"
        story={STORY}
        testId="startup-problem"
        width={472}
      >
        <section
          aria-labelledby="startup-problem-title"
          className="c3fr-problem"
        >
          <span
            aria-hidden="true"
            className="c3fr-problem-icon"
            data-tone={tone}
          >
            {icon}
          </span>
          <h2
            className="c3fr-problem-title"
            id="startup-problem-title"
            tabIndex={-1}
          >
            {title}
          </h2>
          <p className="c3fr-problem-body">{body}</p>
          {details ? (
            <details className="c3fr-details" data-testid="technical-details">
              <summary>Technical details</summary>
              <p>{details}</p>
            </details>
          ) : null}
          {children}
          {actions ? (
            <div className="c3fr-problem-actions">{actions}</div>
          ) : null}
        </section>
      </FirstRunFrame>
    </div>
  );
}
