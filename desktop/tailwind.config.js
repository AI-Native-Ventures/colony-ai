/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. These follow the virtual typography rem
      // (`--buzz-type-rem` in styles/globals/typography.css), which is
      // rem-relative: Cmd +/- zooms it with the rest of the layout, and the
      // Font size preference nudges it alone. Do NOT reintroduce arbitrary `text-[…rem]` / `text-[…px]` literals;
      // the px-text guard rejects them. Stock scale picks up from xs.
      fontSize: {
        "2xs": "calc(var(--buzz-type-rem) * 0.6875)", // 11px at 16px type rem
        "3xs": "calc(var(--buzz-type-rem) * 0.5)", // 8px at 16px type rem
        "update-author": "calc(var(--buzz-type-rem) * 0.83)",
        "update-body": "calc(var(--buzz-type-rem) * 0.89)",
        "update-meta": "calc(var(--buzz-type-rem) * 0.72)",
        badge: "calc(var(--buzz-type-rem) * 0.625)", // 10px at 16px type rem
        compact: "var(--colony-text-compact)", // 13px at 16px type rem
        field: "var(--colony-text-field)", // 14.4px at 16px type rem
        label: "var(--colony-text-label)", // 12.64px at 16px type rem
        "studio-title": "calc(var(--buzz-type-rem) * 1.7)",
        "workspace-date": "calc(var(--buzz-type-rem) * 0.8)",
        "workspace-button": "var(--colony-text-workspace-button)", // 11.84px at 16px type rem
        "onboarding-button": "var(--colony-text-onboarding-button)", // 12.96px at 16px type rem
        "status-indicator": "0.9375rem", // 15px at the default root size
        "channel-title": [
          "calc(var(--buzz-type-rem) * 1.45)",
          { lineHeight: "1.3", letterSpacing: "-0.035em" },
        ],
        // Shared channel, DM, thread, and composer type. Variables keep app-wide
        // font size and keyboard zoom consistent without branching components.
        message: [
          "var(--conversation-message-font-size)",
          { lineHeight: "var(--conversation-message-line-height)" },
        ],
        "message-timestamp": [
          "var(--conversation-timestamp-font-size)",
          { lineHeight: "var(--conversation-timestamp-line-height)" },
        ],
        // 40px at the 16px type rem: onboarding page titles.
        title: [
          "calc(var(--buzz-type-rem) * 2.5)",
          { lineHeight: "1.15", letterSpacing: "-0.02em" },
        ],
        // 36px at the 16px type rem: backup-step private key.
        "nsec-key": [
          "calc(var(--buzz-type-rem) * 2.25)",
          { lineHeight: "1.3" },
        ],
        // 22px at the 16px type rem: compact onboarding-card private key.
        "nsec-key-card": [
          "calc(var(--buzz-type-rem) * 1.375)",
          { lineHeight: "1.3" },
        ],
        "onboarding-heading": [
          "var(--colony-onboarding-heading-size)",
          { lineHeight: "1.15" },
        ],
        "onboarding-display": [
          "var(--colony-onboarding-display-size)",
          { lineHeight: "1.08" },
        ],
      },
      lineHeight: {
        // Keep fixed Tailwind line-height utilities in the typography scale so
        // Cmd +/- cannot enlarge glyphs inside an unchanged line box. Single-
        // line surfaces keep their existing truncate/overflow behavior.
        3: "calc(var(--buzz-type-rem) * 0.75)",
        4: "var(--buzz-type-rem)",
        5: "calc(var(--buzz-type-rem) * 1.25)",
        6: "calc(var(--buzz-type-rem) * 1.5)",
        7: "calc(var(--buzz-type-rem) * 1.75)",
        8: "calc(var(--buzz-type-rem) * 2)",
        "message-author": "var(--conversation-author-line-height)",
        "colony-body": "var(--colony-line-height-body)",
      },
      boxShadow: {
        "content-edge": "-1px -1px 0 0 hsl(var(--sidebar-border) / 0.45)",
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways. `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` cannot do this job
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 hsl(var(--border) / 0.8), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
        "colony-menu": "var(--colony-shadow-menu)",
        "colony-dialog": "var(--colony-shadow-dialog)",
        "colony-drawer": "var(--colony-shadow-drawer)",
        "colony-frame": "var(--colony-shadow-frame)",
        "colony-onboarding": "var(--colony-onboarding-shadow)",
        "colony-onboarding-card": "var(--colony-shadow-onboarding-card)",
        "colony-cta": "var(--colony-shadow-cta)",
        "colony-field": "var(--colony-shadow-field)",
      },
      borderRadius: {
        lg: "var(--colony-radius-card)",
        md: "var(--colony-radius-control-medium)",
        sm: "var(--colony-radius-control)",
        "colony-control": "var(--colony-radius-control)",
        "colony-control-medium": "var(--colony-radius-control-medium)",
        "colony-toast": "var(--colony-radius-toast)",
        "colony-frame": "var(--colony-radius-frame)",
        "colony-card": "var(--colony-radius-card)",
        "colony-dialog": "var(--colony-radius-dialog)",
        "colony-onboarding-control": "var(--colony-radius-onboarding-control)",
        "colony-onboarding-dialog": "var(--colony-radius-onboarding-dialog)",
      },
      spacing: {
        4.5: "1.125rem",
        "status-indicator": "0.9375rem", // 15px at the default root size
        "colony-sidebar": "var(--colony-sidebar-width)",
        "colony-sidebar-min": "var(--colony-sidebar-width-min)",
        "colony-sidebar-max": "var(--colony-sidebar-width-max)",
        "colony-sidebar-step": "var(--colony-sidebar-width-step)",
        "colony-sidebar-collapsed": "var(--colony-sidebar-width-collapsed)",
        "colony-workspace-button-y":
          "var(--colony-workspace-button-padding-block)",
        "colony-workspace-button-x":
          "var(--colony-workspace-button-padding-inline)",
        "colony-workspace-field-y":
          "var(--colony-workspace-field-padding-block)",
        "colony-workspace-field-x":
          "var(--colony-workspace-field-padding-inline)",
        "colony-onboarding-control-y":
          "var(--colony-onboarding-control-padding-block)",
        "colony-onboarding-control-x":
          "var(--colony-onboarding-control-padding-inline)",
        "colony-onboarding-field-y":
          "var(--colony-onboarding-field-padding-block)",
        "colony-onboarding-field-x":
          "var(--colony-onboarding-field-padding-inline)",
        "colony-inbox-row-y": "var(--colony-inbox-row-padding-block)",
        "colony-inbox-row-x": "var(--colony-inbox-row-padding-inline)",
        "colony-workspace-button-height":
          "var(--colony-workspace-button-min-height)",
        "colony-workspace-field-height":
          "var(--colony-workspace-field-min-height)",
        "colony-onboarding-control-height":
          "var(--colony-onboarding-control-min-height)",
        "colony-workspace-dialog-padding":
          "var(--colony-workspace-dialog-padding)",
        "colony-workspace-tabs-height": "var(--colony-workspace-tabs-height)",
        "colony-section-tabs-height": "var(--colony-section-tabs-height)",
        "colony-dialog-offset": "var(--colony-dialog-offset)",
        "colony-toast-offset": "var(--colony-toast-offset)",
        "colony-thread": "var(--colony-thread-width)",
        "colony-thread-min": "var(--colony-thread-width-min)",
        "colony-thread-max": "var(--colony-thread-width-max)",
        "colony-detail-drawer": "var(--colony-detail-drawer-max-width)",
        "colony-workspace-dialog": "var(--colony-workspace-dialog-max-width)",
        "colony-onboarding-dialog": "var(--colony-onboarding-dialog-max-width)",
        "colony-section-inset": "var(--colony-section-tabs-inset)",
        "colony-workspace-tabs-gap": "var(--colony-workspace-tabs-gap)",
        "colony-workspace-tabs-inset": "var(--colony-workspace-tabs-inset)",
        "colony-section-tabs-gap": "var(--colony-section-tabs-gap)",
        "colony-work-row-gap": "var(--colony-work-row-gap)",
        "colony-work-row-y": "var(--colony-work-row-padding-block)",
        "conversation-body": "var(--conversation-body-gap)",
        "conversation-list": "var(--conversation-list-item-gap)",
        "conversation-paragraph": "var(--conversation-paragraph-gap)",
        "conversation-row": "var(--conversation-row-padding-block)",
      },
      fontFamily: {
        sans: ["var(--colony-font-sans)"],
        display: ["var(--colony-font-sans)"],
      },
      letterSpacing: {
        "colony-display": "var(--colony-display-tracking)",
      },
      borderWidth: {
        colony: "var(--colony-border-width)",
        "colony-focus": "var(--colony-focus-width)",
      },
      outlineWidth: {
        colony: "var(--colony-focus-width)",
      },
      outlineOffset: {
        colony: "var(--colony-focus-offset)",
      },
      backgroundImage: {
        "colony-field-light": "var(--colony-field-base-light)",
        "colony-field-dark": "var(--colony-field-base-dark)",
        "colony-onboarding-cta": "var(--colony-onboarding-cta-gradient)",
        "colony-appearance-frame": "var(--colony-appearance-frame-gradient)",
      },
      transitionDuration: {
        "colony-navigation": "var(--colony-motion-navigation)",
        "colony-section": "var(--colony-motion-section)",
        "colony-button": "var(--colony-motion-button)",
        "colony-button-color": "var(--colony-motion-button-color)",
        "colony-action": "var(--colony-motion-action)",
        "colony-dialog": "var(--colony-motion-dialog)",
        "colony-drawer": "var(--colony-motion-drawer)",
        "colony-toast": "var(--colony-motion-toast)",
        "colony-onboarding-spinner": "var(--colony-motion-onboarding-spinner)",
      },
      transitionTimingFunction: {
        colony: "var(--colony-ease-standard)",
        "colony-skeleton": "var(--colony-ease-skeleton)",
        "colony-linear": "var(--colony-ease-linear)",
        "colony-onboarding-spinner": "var(--colony-ease-linear)",
        "colony-emphasized": "var(--colony-ease-emphasized)",
        "colony-drawer-transform": "var(--colony-ease-drawer-transform)",
      },
      colors: {
        colony: {
          fg: "hsl(var(--colony-fg) / <alpha-value>)",
          muted: "hsl(var(--colony-muted) / <alpha-value>)",
          faint: "hsl(var(--colony-faint) / <alpha-value>)",
          border: "hsl(var(--colony-border) / <alpha-value>)",
          surface: "hsl(var(--colony-surface) / <alpha-value>)",
          "surface-raised": "hsl(var(--colony-surface-raised) / <alpha-value>)",
          hover: "hsl(var(--colony-hover) / <alpha-value>)",
          accent: "hsl(var(--colony-accent) / <alpha-value>)",
          "accent-soft": "hsl(var(--colony-accent-soft) / <alpha-value>)",
          info: "hsl(var(--colony-info) / <alpha-value>)",
          success: "hsl(var(--colony-success) / <alpha-value>)",
          danger: "hsl(var(--colony-danger) / <alpha-value>)",
          canvas: "hsl(var(--colony-canvas) / <alpha-value>)",
          field: "hsl(var(--colony-field) / <alpha-value>)",
          focus: "hsl(var(--colony-focus) / <alpha-value>)",
          "sidebar-active-indicator": "var(--colony-sidebar-active-indicator)",
          "sidebar-active-surface": "var(--colony-sidebar-active-surface)",
          "sidebar-hover-surface": "var(--colony-sidebar-hover-surface)",
          "sidebar-foreground":
            "hsl(var(--colony-sidebar-foreground) / <alpha-value>)",
          "sidebar-selected-foreground":
            "hsl(var(--colony-sidebar-selected-foreground) / <alpha-value>)",
        },
        onboarding: {
          fg: "hsl(var(--colony-onboarding-fg) / <alpha-value>)",
          muted: "hsl(var(--colony-onboarding-muted) / <alpha-value>)",
          border: "hsl(var(--colony-onboarding-border) / <alpha-value>)",
          surface: "hsl(var(--colony-onboarding-surface) / <alpha-value>)",
          field: "hsl(var(--colony-onboarding-field) / <alpha-value>)",
          wash: "hsl(var(--colony-onboarding-wash) / <alpha-value>)",
          accent: "hsl(var(--colony-onboarding-accent) / <alpha-value>)",
          focus: "hsl(var(--colony-onboarding-focus) / <alpha-value>)",
          danger: "hsl(var(--colony-onboarding-danger) / <alpha-value>)",
          success: "hsl(var(--colony-onboarding-success) / <alpha-value>)",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
        },
      },
    },
  },
  plugins: [],
};
