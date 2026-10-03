import * as React from "react";
import type { ScoutPose } from "./scoutGuidance";

/** Eyeless Scout rig from the frozen onboarding r4 ant.js, with scoped SVG IDs. */
export function ScoutAvatar({
  pose = "hello",
  className = "",
}: {
  pose?: ScoutPose;
  className?: string;
}) {
  const id = React.useId();
  const head = `${id}-head`;
  const stem = `${id}-stem`;
  return (
    <span
      aria-hidden="true"
      className={`scout-ant ${className}`}
      data-pose={pose}
    >
      <svg aria-hidden="true" viewBox="-120 -145 240 235">
        <defs>
          <radialGradient id={head} cx="30%" cy="18%" r="92%">
            <stop offset="0" stopColor="#a5bd8d" />
            <stop offset=".50" stopColor="#719763" />
            <stop offset="1" stopColor="#3d694c" />
          </radialGradient>
          <linearGradient id={stem} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#a5bd8d" />
            <stop offset=".5" stopColor="#719763" />
            <stop offset="1" stopColor="#3d694c" />
          </linearGradient>
        </defs>
        <ellipse cx="0" cy="69" rx="37" ry="4" fill="#3d694c" opacity=".06" />
        <g className="scout-body">
          <g className="scout-left-antenna">
            <path
              d="M-25 -35 C-33 -57 -79 -122 -34 -104"
              fill="none"
              stroke={`url(#${stem})`}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <ellipse
              cx="-34"
              cy="-104"
              rx="11"
              ry="8"
              transform="rotate(-18 -34 -104)"
              fill={`url(#${head})`}
            />
          </g>
          <g className="scout-right-antenna">
            <path
              d="M25 -35 C33 -57 48 -122 64 -104"
              fill="none"
              stroke={`url(#${stem})`}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <ellipse
              cx="64"
              cy="-104"
              rx="11"
              ry="8"
              transform="rotate(18 64 -104)"
              fill={`url(#${head})`}
            />
          </g>
          <path
            d="M0 -48C-30 -48 -53 -29 -53 0C-53 30 -34 49 0 49C31 49 54 34 55 6C57 -26 29 -48 0 -48Z"
            fill={`url(#${head})`}
          />
        </g>
      </svg>
    </span>
  );
}
