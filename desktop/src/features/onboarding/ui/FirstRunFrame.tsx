import * as React from "react";

import { CheckIcon } from "./firstRunIcons";
import "./firstRun.css";
import { ScoutAvatar } from "./ScoutAvatar";
import type { ScoutPose } from "./scoutGuidance";

export type FirstRunTone = "help" | "turn" | "working";

/**
 * Panel and column measures each board draws, in design px. The boards share
 * one frame but not one set of numbers (the reset, profile, advanced sign-in
 * and startup boards are narrower panels with a larger headline step down).
 */
export const FIRST_RUN_LAYOUTS = {
  default: {},
  business: { avatar: 88, h1: 48, h1Lh: 1.04, storyGap: 24, wrapPad: 28 },
  /** Boards that set the column 28px from the top links instead of 32. */
  tight: { wrapPad: 28 },
  reset: {
    basis: 440,
    max: 520,
    padX: 44,
    avatar: 96,
    h1: 48,
    h1Lh: 1.03,
    storyGap: 24,
    bodyMax: 400,
    progressGap: 8,
    progressText: 13.5,
    mainBasis: 600,
    mainPx: 44,
  },
  profile: {
    basis: 420,
    max: 480,
    padX: 44,
    avatar: 96,
    h1: 50,
    h1Lh: 1.03,
    storyGap: 24,
    bodyMax: 400,
    mainBasis: 640,
    mainPt: 40,
    mainPx: 44,
    mainPb: 40,
  },
  advanced: {
    basis: 400,
    max: 460,
    padX: 40,
    avatar: 88,
    h1: 44,
    h1Lh: 1.04,
    storyGap: 24,
    bodyMax: 360,
    bodySize: 17.5,
    mainBasis: 640,
    mainPx: 40,
    mainPb: 36,
  },
  startup: {
    basis: 400,
    max: 440,
    padX: 40,
    avatar: 88,
    h1: 46,
    h1Lh: 1.04,
    storyGap: 24,
    bodyMax: 360,
    mainBasis: 640,
    mainPt: 40,
    mainPx: 40,
    mainPb: 36,
  },
} as const;
export type FirstRunLayout = keyof typeof FIRST_RUN_LAYOUTS;

type LayoutMeasures = {
  basis?: number;
  max?: number;
  padX?: number;
  avatar?: number;
  h1?: number;
  h1Lh?: number;
  storyGap?: number;
  bodyMax?: number;
  bodySize?: number;
  progressGap?: number;
  progressText?: number;
  wrapPad?: number;
  mainBasis?: number;
  mainPt?: number;
  mainPx?: number;
  mainPb?: number;
};

const VARIABLES: Array<[keyof LayoutMeasures, string]> = [
  ["basis", "--c3fr-basis"],
  ["max", "--c3fr-max"],
  ["padX", "--c3fr-padx"],
  ["avatar", "--c3fr-avatar"],
  ["h1", "--c3fr-h1"],
  ["h1Lh", "--c3fr-h1-lh"],
  ["storyGap", "--c3fr-story-gap"],
  ["bodyMax", "--c3fr-body-max"],
  ["bodySize", "--c3fr-body-size"],
  ["progressGap", "--c3fr-progress-gap"],
  ["progressText", "--c3fr-progress-text"],
  ["wrapPad", "--c3fr-wrap-pad"],
  ["mainBasis", "--c3fr-main-basis"],
  ["mainPt", "--c3fr-main-pt"],
  ["mainPx", "--c3fr-main-px"],
  ["mainPb", "--c3fr-main-pb"],
];

function layoutStyle(layout: FirstRunLayout): React.CSSProperties {
  const measures: LayoutMeasures = FIRST_RUN_LAYOUTS[layout];
  const style: Record<string, number> = {};
  for (const [key, name] of VARIABLES) {
    const value = measures[key];
    if (value !== undefined) style[name] = value;
  }
  return style as React.CSSProperties;
}

export type FirstRunStep = {
  label: string;
  state: "done" | "current" | "todo";
};

/** What Scout says on the left of a first-run screen. */
export type FirstRunStory = {
  heading: string;
  body: string;
  status: string;
  tone: FirstRunTone;
  pose: ScoutPose;
  /** Speech bubble under the body. */
  bubble?: string;
  /** Card between the body and the progress (the live workspace preview). */
  extra?: React.ReactNode;
  /** Replaces the progress bars: a button or a line at the bottom. */
  footer?: React.ReactNode;
  progress?: ReadonlyArray<FirstRunStep> | null;
  progressLabel?: string;
};

/** The three soft colours behind Scout, drawn as on the boards (not per person). */
function StoryField() {
  const grainId = `c3fr-grain-${React.useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden="true" className="c3fr-field">
      <div className="c3fr-field-blob" data-blob="top" />
      <div className="c3fr-field-blob" data-blob="middle" />
      <div className="c3fr-field-blob" data-blob="bottom" />
      <div className="c3fr-field-veil" />
      <svg
        aria-hidden="true"
        className="c3fr-field-grain"
        height="100%"
        width="100%"
      >
        <filter id={grainId}>
          <feTurbulence
            baseFrequency=".85"
            numOctaves="2"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect filter={`url(#${grainId})`} height="100%" width="100%" />
      </svg>
    </div>
  );
}

/** Scout's head, small, for the speech bubble (the avatar rig is too heavy at 22px). */
export function ScoutHeadMark({ className }: { className?: string }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" className={className} viewBox="-60 -60 120 120">
      <defs>
        <radialGradient cx="30%" cy="18%" id={`${id}-h`} r="92%">
          <stop offset="0" stopColor="#a5bd8d" />
          <stop offset=".5" stopColor="#719763" />
          <stop offset="1" stopColor="#3d694c" />
        </radialGradient>
      </defs>
      <path
        d="M0 -48C-30 -48 -53 -29 -53 0C-53 30 -34 49 0 49C31 49 54 34 55 6C57 -26 29 -48 0 -48Z"
        fill={`url(#${id}-h)`}
      />
    </svg>
  );
}

export function FirstRunProgress({
  label = "Setup progress",
  steps,
}: {
  label?: string;
  steps: ReadonlyArray<FirstRunStep>;
}) {
  return (
    <ol
      aria-label={label}
      className="c3fr-progress"
      style={{ "--c3fr-steps": steps.length } as React.CSSProperties}
    >
      {steps.map((step) => (
        <li
          aria-current={step.state === "current" ? "step" : undefined}
          data-state={step.state}
          key={step.label}
        >
          <span aria-hidden="true" className="c3fr-progress-bar" />
          <span className="c3fr-progress-label">
            {step.state === "done" ? (
              <CheckIcon size={13} strokeWidth={3} />
            ) : null}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function FirstRunStoryPanel({ story }: { story: FirstRunStory }) {
  return (
    <aside aria-label="Scout, your Chief of Staff" className="c3fr-story">
      <StoryField />
      <span className="c3fr-wordmark" data-testid="onboarding-logo">
        colony
      </span>
      <div className="c3fr-story-main">
        <div className="c3fr-scout" data-pose={story.pose}>
          <div className="c3fr-scout-avatar">
            <ScoutAvatar pose={story.pose} />
          </div>
          <div className="c3fr-scout-id">
            <span className="c3fr-scout-name">
              Scout <span>· Chief of Staff</span>
            </span>
            <span className="c3fr-status" data-tone={story.tone} role="status">
              <i
                aria-hidden="true"
                className={story.tone === "working" ? "c3fr-live" : undefined}
              />
              {story.status}
            </span>
          </div>
        </div>
        <h1 className="c3fr-story-heading">{story.heading}</h1>
        <p className="c3fr-story-body">{story.body}</p>
        {story.bubble ? (
          <div className="c3fr-bubble">
            <ScoutHeadMark className="c3fr-bubble-mark" />
            {story.bubble}
          </div>
        ) : null}
        {story.extra}
      </div>
      {story.footer ? (
        story.footer
      ) : story.progress ? (
        <FirstRunProgress label={story.progressLabel} steps={story.progress} />
      ) : (
        <span aria-hidden="true" />
      )}
    </aside>
  );
}

export type FirstRunFrameProps = {
  testId: string;
  story: FirstRunStory;
  /** Links at the top right of the form column. */
  top?: React.ReactNode;
  /** Width of the form column in design px. */
  width?: number;
  gap?: number;
  layout?: FirstRunLayout;
  /** The right side lays itself out (cards in a grid); no centred column. */
  wide?: boolean;
  /** Remembers which field is focused, so Scout can answer it. */
  onFocusCapture?: React.FocusEventHandler<HTMLElement>;
  children: React.ReactNode;
};

/** The shared first-run screen: Scout on the left, the step on the right. */
export function FirstRunFrame({
  testId,
  story,
  top,
  width = 460,
  gap,
  layout = "default",
  wide = false,
  onFocusCapture,
  children,
}: FirstRunFrameProps) {
  const columnStyle = {
    "--c3fr-width": width,
    ...(gap ? { "--c3fr-gap": gap } : {}),
  } as React.CSSProperties;
  return (
    <div className="c3fr-scroll" style={layoutStyle(layout)}>
      <div className="c3fr-root" data-testid={testId}>
        <FirstRunStoryPanel story={story} />
        <main
          className="c3fr-main"
          data-wide={wide ? "true" : undefined}
          onFocusCapture={onFocusCapture}
        >
          {wide ? (
            children
          ) : (
            <>
              <div className="c3fr-top">{top}</div>
              <div className="c3fr-column-wrap">
                <div className="c3fr-column" style={columnStyle}>
                  {children}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export function FirstRunHead({
  title,
  lede,
  headingRef,
  children,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
  children?: React.ReactNode;
}) {
  return (
    <div className="c3fr-head">
      <h2 className="c3fr-title" ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      {lede ? <p className="c3fr-lede">{lede}</p> : null}
      {children}
    </div>
  );
}
