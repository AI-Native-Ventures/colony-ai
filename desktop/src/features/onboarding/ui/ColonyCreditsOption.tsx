import * as React from "react";
import { AntMark } from "./OnboardingScenePrimitives";

/**
 * Colony credits are Colony Agent's second power source. Purchase is not wired
 * yet, so the option stays visible with a not-ready state and no controls.
 */
export function ColonyCreditsOption() {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className="colony-credits-option"
      data-testid="onboarding-credits-coming-soon"
    >
      <span aria-hidden="true" className="colony-credits-mark">
        <AntMark />
      </span>
      <div>
        <h3 id={headingId}>Colony credits</h3>
        <p>
          Pay Colony for Colony Agent’s AI use, with no other account needed.
          Not available yet, so connect OpenRouter to start today.
        </p>
      </div>
      <span className="colony-credits-state">Coming soon</span>
    </section>
  );
}
