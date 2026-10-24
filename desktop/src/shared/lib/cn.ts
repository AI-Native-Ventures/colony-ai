import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The named font-size tokens in `tailwind.config.js`. tailwind-merge reads no
 * Tailwind config, so an unregistered `text-control` is taken for a text
 * colour and drops the colour it sits beside (a primary button's
 * `text-colony-surface` lost to its size's `text-control`).
 */
const FONT_SIZE_TOKENS = [
  "message-author",
  "company-title",
  "menu",
  "hero",
  "chip",
  "title-md",
  "control",
  "2xs",
  "3xs",
  "update-author",
  "update-body",
  "update-meta",
  "badge",
  "factory-indicator",
  "compact",
  "field",
  "label",
  "studio-title",
  "workspace-date",
  "workspace-card-title",
  "workspace-card-body",
  "workspace-card-meta",
  "workspace-attention-title",
  "workspace-attention-meta",
  "today-status",
  "workspace-review-meta",
  "workspace-button",
  "onboarding-button",
  "settings-title",
  "settings-nav-title",
  "settings-topbar",
  "status-indicator",
  "voice-note",
  "channel-title",
  "message",
  "message-timestamp",
  "title",
  "nsec-key",
  "nsec-key-card",
  "onboarding-heading",
  "onboarding-display",
];

const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: FONT_SIZE_TOKENS,
        },
      ],
      rounded: ["rounded-squircle"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
