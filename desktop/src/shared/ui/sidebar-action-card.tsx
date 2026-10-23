import * as React from "react";
import type { ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  type Transition,
  useReducedMotion,
} from "motion/react";

import { cn } from "@/shared/lib/cn";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  POOF_DURATION_MS,
  POOF_ORIGIN_CLASS,
  POOF_TRIGGER_CLASS,
} from "@/shared/ui/PoofBurstProvider";

type SidebarActionCardTone =
  | "neutral"
  | "success"
  | "danger"
  | "accent"
  | "need"
  | "info";
export type SidebarActionCardSurface = "background" | "secondary";

type SidebarCompactActionCardProps = {
  actionAriaLabel: string;
  actionDisabled?: boolean;
  actionTestId?: string;
  className?: string;
  description?: string;
  dismissClassName?: string;
  dismissLabel?: string;
  iconKey?: string;
  icon: ReactNode;
  onAction: () => void;
  onDismiss?: () => void;
  role?: "alert" | "status";
  surface?: SidebarActionCardSurface;
  testId: string;
  title: string;
  tone?: SidebarActionCardTone;
};

type SidebarActionDismissButtonProps = {
  className?: string;
  isDismissing: boolean;
  label: string;
  onDismiss: () => void;
  onDismissStart: () => void;
  testId: string;
};

type SidebarActionDescriptionTransition = {
  current: string;
  isAnimating: boolean;
  previous: string;
  version: number;
};

const SIDEBAR_ACTION_DESCRIPTION_SETTLE_DELAY_MS = 260;

function SidebarActionDescriptionText({
  shouldReduceMotion,
  value,
}: {
  shouldReduceMotion: boolean;
  value: string;
}) {
  const [transition, setTransition] =
    React.useState<SidebarActionDescriptionTransition>(() => ({
      current: value,
      isAnimating: false,
      previous: value,
      version: 0,
    }));

  React.useLayoutEffect(() => {
    setTransition((currentTransition) => {
      if (currentTransition.current === value) {
        return currentTransition;
      }

      return {
        current: value,
        isAnimating: !shouldReduceMotion,
        previous: currentTransition.current,
        version: currentTransition.version + 1,
      };
    });
  }, [shouldReduceMotion, value]);

  React.useEffect(() => {
    if (!transition.isAnimating) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTransition((currentTransition) => {
        if (currentTransition.version !== transition.version) {
          return currentTransition;
        }

        return {
          ...currentTransition,
          isAnimating: false,
          previous: currentTransition.current,
        };
      });
    }, SIDEBAR_ACTION_DESCRIPTION_SETTLE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [transition.isAnimating, transition.version]);

  if (shouldReduceMotion || !transition.isAnimating) {
    return (
      <span className="buzz-sidebar-action-description">
        {transition.current}
      </span>
    );
  }

  return (
    <span className="buzz-sidebar-action-description">
      <span className="sr-only">{transition.current}</span>
      <span aria-hidden className="buzz-sidebar-action-description__motion">
        <span
          className="buzz-sidebar-action-description__reel"
          key={`${transition.version}-${transition.previous}-${transition.current}`}
        >
          <span>{transition.previous}</span>
          <span>{transition.current}</span>
        </span>
      </span>
    </span>
  );
}

function SidebarActionDismissButton({
  className,
  isDismissing,
  label,
  onDismiss,
  onDismissStart,
  testId,
}: SidebarActionDismissButtonProps) {
  const dismissTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  return (
    <button
      aria-label={label}
      className={cn(
        "colony-sidebar-notice-dismiss",
        POOF_TRIGGER_CLASS,
        className,
      )}
      data-testid={testId}
      disabled={isDismissing}
      onClick={(event) => {
        event.stopPropagation();
        if (dismissTimeoutRef.current !== null) {
          return;
        }
        onDismissStart();
        dismissTimeoutRef.current = window.setTimeout(() => {
          dismissTimeoutRef.current = null;
          onDismiss();
        }, POOF_DURATION_MS);
      }}
      type="button"
    >
      <CloseIcon size={14} />
    </button>
  );
}

function dismissTestId(testId: string) {
  return testId === "sidebar-update-card"
    ? "sidebar-update-dismiss"
    : `${testId}-dismiss`;
}

export function SidebarCompactActionCard({
  actionAriaLabel,
  actionDisabled = false,
  actionTestId,
  className,
  description,
  dismissClassName,
  dismissLabel = "Dismiss notification",
  icon,
  iconKey,
  onAction,
  onDismiss,
  role,
  surface = "background",
  testId,
  title,
  tone = "neutral",
}: SidebarCompactActionCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const [isDismissing, setIsDismissing] = React.useState(false);
  const resolvedIconKey = iconKey ?? title;
  const cardTransition: Transition = shouldReduceMotion
    ? { duration: 0.08 }
    : {
        duration: 0.28,
        ease: [0.22, 1, 0.36, 1] as const,
      };
  const cardHiddenState = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.9 };
  const cardVisibleState = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1 };
  const contentTransition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : {
        duration: 0.16,
        ease: [0.22, 1, 0.36, 1] as const,
      };
  const contentInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 3 };
  const contentExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: -3 };

  return (
    <motion.div
      animate={isDismissing ? cardHiddenState : cardVisibleState}
      className={cn(
        "colony-sidebar-notice group/sidebar-compact-action-card w-full origin-bottom",
        POOF_ORIGIN_CLASS,
        isDismissing && "pointer-events-none",
        className,
      )}
      data-dismissible={onDismiss ? "true" : undefined}
      data-dismissing={isDismissing ? "true" : undefined}
      data-surface={surface}
      data-testid={testId}
      data-tone={tone}
      exit={cardHiddenState}
      initial={cardHiddenState}
      role={role}
      transition={cardTransition}
    >
      <motion.span
        aria-hidden="true"
        className="colony-sidebar-notice-icon"
        layout="position"
        transition={contentTransition}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center"
            exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.95 }}
            initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.95 }}
            key={resolvedIconKey}
            transition={contentTransition}
          >
            {icon}
          </motion.span>
        </AnimatePresence>
      </motion.span>
      <button
        aria-label={actionAriaLabel}
        className="colony-sidebar-notice-copy focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
        data-testid={actionTestId}
        disabled={actionDisabled}
        onClick={onAction}
        type="button"
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            animate={{ opacity: 1, y: 0 }}
            className="colony-sidebar-notice-title"
            exit={contentExit}
            initial={contentInitial}
            key={title}
            transition={contentTransition}
          >
            {title}
          </motion.span>
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {description ? (
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              className="colony-sidebar-notice-detail"
              exit={contentExit}
              initial={contentInitial}
              key="description"
              transition={contentTransition}
            >
              <SidebarActionDescriptionText
                shouldReduceMotion={Boolean(shouldReduceMotion)}
                value={description}
              />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>
      {onDismiss ? (
        <SidebarActionDismissButton
          className={dismissClassName}
          isDismissing={isDismissing}
          label={dismissLabel}
          onDismiss={onDismiss}
          onDismissStart={() => setIsDismissing(true)}
          testId={dismissTestId(testId)}
        />
      ) : null}
    </motion.div>
  );
}
