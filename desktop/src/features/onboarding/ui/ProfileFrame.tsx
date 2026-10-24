import type * as React from "react";

import { FirstRunFrame, type FirstRunStory } from "./FirstRunFrame";
import { CheckIcon } from "./firstRunIcons";

function profileStory(stage: "before" | "after"): FirstRunStory {
  return {
    heading: "What should I call you?",
    body: "Use the name you’d like your team to know. A face helps too, for people and agents alike.",
    status: "Your turn",
    tone: "turn",
    pose: "waiting",
    // Before the business exists the bars read Account, Business, Connect from
    // the start; after it, only the account part is still open.
    progress: [
      { label: "Account", state: "current" },
      { label: "Business", state: stage === "after" ? "done" : "todo" },
      { label: "Connect", state: stage === "after" ? "done" : "todo" },
    ],
  };
}

/** Scout on the left, the name and photo cards on the right. */
export function ProfileFrame({
  stage,
  testId,
  children,
}: {
  /** Where the profile step sits: before the business is made, or after. */
  stage: "before" | "after";
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <FirstRunFrame
      layout="profile"
      story={profileStory(stage)}
      testId={testId}
      wide
    >
      <div className="c3fr-profile-wrap">{children}</div>
    </FirstRunFrame>
  );
}

/** Step 1 once it is done: the name that was chosen, beside the photo card. */
export function ProfileDoneCard({ name }: { name: string }) {
  return (
    <section
      aria-labelledby="op-name-done-title"
      className="c3fr-profile-card"
      data-testid="onboarding-name-done"
    >
      <span className="c3fr-eyebrow c3fr-eyebrow-done">
        <CheckIcon size={14} strokeWidth={3} />
        Step 1 of 2
      </span>
      <div className="c3fr-head">
        <h2 className="c3fr-title c3fr-title-profile" id="op-name-done-title">
          What should we call you?
        </h2>
        <p className="c3fr-lede c3fr-lede-card">
          Pick the name people and agents will see in Colony. You can change it
          anytime.
        </p>
      </div>
      <div className="c3fr-field-group">
        <span className="c3fr-label">Name</span>
        <output className="c3fr-input c3fr-input-done">{name}</output>
      </div>
    </section>
  );
}

/** The two profile cards side by side, as the board draws them. */
export function ProfilePair({ children }: { children: React.ReactNode }) {
  return <div className="c3fr-profile-pair">{children}</div>;
}
