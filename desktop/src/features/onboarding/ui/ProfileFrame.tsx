import type * as React from "react";

import { FirstRunFrame, type FirstRunStory } from "./FirstRunFrame";

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
