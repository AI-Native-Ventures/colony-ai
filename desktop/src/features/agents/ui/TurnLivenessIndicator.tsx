import { useReducedMotion } from "motion/react";

import { cn } from "@/shared/lib/cn";
import { ScoutAvatar } from "@/features/onboarding/ui/ScoutAvatar";
import { ColonyMark } from "@/shared/ui/ColonyMark";
import { useTranscriptAnimationEnabled } from "./transcriptAnimationPreference";

export function TurnLivenessIndicator({
  className,
}: {
  className?: string;
  /** Retained for callers; the indicator stays mounted for whole turns. */
  fuzz?: boolean;
}) {
  const animationsEnabled = useTranscriptAnimationEnabled();
  const shouldReduceMotion = useReducedMotion();
  const showPresence = animationsEnabled && !shouldReduceMotion;

  if (!showPresence) {
    return (
      <div
        aria-label="Agent turn in progress"
        className={cn("opacity-25", className)}
        data-testid="turn-liveness-indicator"
        role="status"
      >
        <ColonyMark className="w-6 text-foreground" />
      </div>
    );
  }

  return (
    <div
      aria-label="Agent turn in progress"
      className={cn("flex items-center gap-1.5 opacity-25", className)}
      data-testid="turn-liveness-indicator"
      role="status"
    >
      <ScoutAvatar pose="working" className="block w-6" />
    </div>
  );
}
