import { defineConfig, devices } from "@playwright/test";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const canaryEnabled = process.env.BUZZ_E2E_CANARY === "1";
const canaryAccountFile = process.env.BUZZ_E2E_CANARY_ACCOUNT_FILE;
const canaryArtifactDir = process.env.BUZZ_E2E_CANARY_ARTIFACT_DIR;
const appPort = canaryEnabled ? 4174 : 4173;

function assertOutsideRepository(path: string, label: string) {
  const repositoryRoot = realpathSync(resolve(process.cwd(), ".."));
  const actualPath = realpathSync(path);
  const relativePath = relative(repositoryRoot, actualPath);
  if (
    !relativePath ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  ) {
    throw new Error(`${label} must be outside the repository.`);
  }
}

if (canaryEnabled) {
  if (process.env.CI) {
    throw new Error("The canary Playwright project is local-only.");
  }
  if (!canaryAccountFile || !canaryArtifactDir) {
    throw new Error(
      "The canary project requires its account file and artifact directory environment variables.",
    );
  }
  if (!isAbsolute(canaryAccountFile) || !isAbsolute(canaryArtifactDir)) {
    throw new Error("Canary account and artifact paths must be absolute.");
  }
  const canaryAccountRoot = realpathSync(
    resolve(process.env.HOME ?? "", ".colony-canary"),
  );
  const accountRelativePath = relative(
    canaryAccountRoot,
    realpathSync(canaryAccountFile),
  );
  if (
    !accountRelativePath ||
    accountRelativePath === ".." ||
    accountRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("The canary account file must be inside ~/.colony-canary.");
  }
  assertOutsideRepository(canaryAccountFile, "The canary account file");
  assertOutsideRepository(canaryArtifactDir, "The canary artifact directory");
}

const canaryProjects = canaryEnabled
  ? [
      {
        name: "canary",
        testMatch: "**/company-canary.canary.spec.ts",
        retries: 0,
        use: {
          ...devices["Desktop Chrome"],
          viewport: { width: 1440, height: 900 },
          screenshot: "off" as const,
          trace: "off" as const,
          video: "off" as const,
        },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: canaryEnabled ? 30_000 : 5_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir:
    canaryEnabled && canaryArtifactDir
      ? resolve(canaryArtifactDir, "playwright-results")
      : "test-results",
  reporter: canaryEnabled
    ? [["list"]]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "smoke",
      testMatch: [
        "**/first-reply-runtime.spec.ts",
        "**/smoke.spec.ts",
        "**/account-auth.spec.ts",
        "**/self-serve-community-onboarding.spec.ts",
        "**/owned-agent-discovery.spec.ts",
        "**/agent-profile-instructions.spec.ts",
        "**/thread-head-stale-edit.spec.ts",
        "**/sidebar-offcanvas-rail.spec.ts",
        "**/sidebar-full-app.spec.ts",
        "**/sidebar-reference-fixture.spec.ts",
        "**/tooltip-semantics.spec.ts",
        "**/search-scope-screenshots.spec.ts",
        "**/onboarding-docked-cta-screenshots.spec.ts",
        "**/onboarding-design.spec.ts",
        "**/onboarding-community-entry.spec.ts",
        "**/identity-key-help.spec.ts",
        "**/exact-key-profile.spec.ts",
        "**/key-import-reveal.spec.ts",
        "**/navigation.spec.ts",
        "**/relay-request-budget.spec.ts",
        "**/channels.spec.ts",
        "**/channel-shared-header-backdrop.spec.ts",
        "**/auxiliary-pane-close-visibility.spec.ts",
        "**/channel-composer-overflow.spec.ts",
        "**/badge.spec.ts",
        "**/channel-browser.spec.ts",
        "**/channel-add-screenshots.spec.ts",
        "**/add-community-screenshots.spec.ts",
        "**/hosted-communities-settings-screenshots.spec.ts",
        "**/invites-settings-screenshots.spec.ts",
        "**/messaging.spec.ts",
        "**/bestie.spec.ts",
        "**/message-feedback-snapshots.spec.ts",
        "**/send-feedback-settings.spec.ts",
        "**/message-copy-link.spec.ts",
        "**/custom-emoji.spec.ts",
        "**/profile-custom-emoji-status.spec.ts",
        "**/custom-emoji-ui.spec.ts",
        "**/moderation-queue-failure.spec.ts",
        "**/channel-mute.spec.ts",
        "**/channel-star.spec.ts",
        "**/channel-controls.spec.ts",
        "**/channel-activity-popover.spec.ts",
        "**/active-turn-resilience.spec.ts",
        "**/agent-control-regressions.spec.ts",
        "**/profile-active-turn.spec.ts",
        "**/config-bridge-screenshots.spec.ts",
        "**/observer-feed-screenshots.spec.ts",
        "**/core-memory-screenshots.spec.ts",
        "**/activity-scope-label-screenshots.spec.ts",
        "**/welcome-agent-modal-screenshots.spec.ts",
        "**/local-archive-screenshots.spec.ts",
        "**/voice-settings.spec.ts",
        "**/voice-note.spec.ts",
        "**/agent-readiness-screenshots.spec.ts",
        "**/agent-error-state-screenshots.spec.ts",
        "**/edit-agent.spec.ts",
        "**/doctor-cta-screenshots.spec.ts",
        "**/pubkey-display-screenshots.spec.ts",
        "**/file-attachment.spec.ts",
        "**/image-attachment-gallery.spec.ts",
        "**/composer-image-draw.spec.ts",
        "**/video-attachment.spec.ts",
        "**/spoiler.spec.ts",
        "**/composer-link-shortcut.spec.ts",
        "**/entity-link-recipient-cards.spec.ts",
        "**/composer-selection-formatting.spec.ts",
        "**/composer-tooltip-dismiss.spec.ts",
        "**/mentions.spec.ts",
        "**/mention-spacing.spec.ts",
        "**/mention-clipboard.spec.ts",
        "**/cloud-provenance.spec.ts",
        "**/mention-recipients.spec.ts",
        "**/remote-owned-mentions.spec.ts",
        "**/forum-agent-invitation.spec.ts",
        "**/team-mentions.spec.ts",
        "**/persistent-agent-audience.spec.ts",
        "**/relay-reconnect.spec.ts",
        "**/relay-reconnect-affordance.spec.ts",
        "**/workflows.spec.ts",
        "**/company-asks.spec.ts",
        "**/company-hiring.spec.ts",
        "**/company-duty-ask.spec.ts",
        "**/company-team.spec.ts",
        "**/company-spend.spec.ts",
        "**/company-permissions.spec.ts",
        "**/company-work.spec.ts",
        "**/asks-2.spec.ts",
        "**/factory.spec.ts",
        "**/factoryPreview.spec.ts",
        "**/goals.spec.ts",
        "**/workflow-reaction-picker.spec.ts",
        "**/workflow-local-controls.spec.ts",
        "**/workflow-title-stability.spec.ts",
        "**/identity-archive.spec.ts",
        "**/identity-archive-hide.spec.ts",
        "**/relay-connectivity.spec.ts",
        "**/unread-pill.spec.ts",
        "**/sidebar-more-unread-overlap.spec.ts",
        "**/sidebar-snapshot.spec.ts",
        "**/home-collapsed-top-chrome.spec.ts",
        "**/top-chrome-zoom-clearance.spec.ts",
        "**/thread-unread.spec.ts",
        "**/thread-load-failure.spec.ts",
        "**/project-conversation-load-failure.spec.ts",
        "**/huddle-thread-load-failure.spec.ts",
        "**/workspace-rail.spec.ts",
        "**/community-rail.spec.ts",
        "**/boot-splash.spec.ts",
        "**/thread-reply-anchor-roleplay.spec.ts",
        "**/threadpane-ultrawide.spec.ts",
        "**/thread-focus-mode.spec.ts",
        "**/animated-avatar.spec.ts",
        "**/reminders.spec.ts",
        "**/reminder-click-repro.spec.ts",
        "**/virtualization.spec.ts",
        "**/scroll-history.spec.ts",
        "**/channel-dense-second-reach.spec.ts",
        "**/channel-window-mock-paging.spec.ts",
        "**/channel-head-restart.spec.ts",
        "**/live-broadcast-reply-timeline.spec.ts",
        "**/markdown-parse-cache.spec.ts",
        "**/markdown-tables.spec.ts",
        "**/overscroll-boundary.spec.ts",
        "**/terminal-wheel.spec.ts",
        "**/cold-switch-longtask.perf.ts",
        "**/timeline-no-shift.spec.ts",
        "**/human-edit-agent-content.spec.ts",
        "**/empty-edit-delete.spec.ts",
        "**/reaction-order.spec.ts",
        "**/reaction-names.spec.ts",
        "**/inbox-reactions.spec.ts",
        "**/inbox-edit.spec.ts",
        "**/send-channel-binding.spec.ts",
        "**/project-cold-start.spec.ts",
        "**/project-commit-detail.spec.ts",
        "**/project-empty-state-alignment.spec.ts",
        "**/project-inbox.spec.ts",
        "**/projects-v3-screenshots.spec.ts",
        "**/project-issue-comments.spec.ts",
        "**/project-pr-review.spec.ts",
        "**/persona-model-combobox-screenshots.spec.ts",
        "**/drafts-screenshots.spec.ts",
        "**/drafts-all-fix-screenshots.spec.ts",
        "**/inbox-refactor-screenshots.spec.ts",
        "**/inbox-title-overlap.spec.ts",
        "**/message-author-overlap.spec.ts",
        "**/buzz-theme-screenshots.spec.ts",
        "**/appearance-previews.spec.ts",
        "**/channel-sort.spec.ts",
        "**/identity-lost.spec.ts",
        "**/deep-link-invite.spec.ts",
        "**/invite-link-copy.spec.ts",
        "**/global-agent-config-screenshots.spec.ts",
        "**/doctor-states.spec.ts",
        "**/onboarding-avatar-skip.spec.ts",
        "**/onboarding-backup.spec.ts",
        "**/onboarding-agent-defaults.spec.ts",
        "**/nostr-bind.spec.ts",
        "**/mobile-pairing-qr.spec.ts",
        "**/profile-nsec-reveal.spec.ts",
        "**/profile-backup-settings.spec.ts",
        "**/signout-confirmation.spec.ts",
        "**/settings-section-layout.spec.ts",
        "**/experimental-features.spec.ts",
        "**/agent-provider-dropdowns.spec.ts",
        "**/agent-lifecycle-feedback.spec.ts",
        "**/agent-access-warning.spec.ts",
        "**/edit-agent-run-on.spec.ts",
        "**/inbox-live-update.spec.ts",
        "**/mesh-compute.spec.ts",
        "**/observer-archive-policy.spec.ts",
        "**/harness-management.spec.ts",
        "**/harness-catalog-screenshots.spec.ts",
        "**/inline-custom-harness.spec.ts",
        "**/where-to-run-config.spec.ts",
        "**/huddle-transcription.spec.ts",
        "**/agent-numeric-tuning.spec.ts",
        "**/needs-restart-screenshots.spec.ts",
        "**/team-catalog-screenshots.spec.ts",
        "**/w07-agents-smoke.spec.ts",
        "**/w10-discovery-sales.spec.ts",
        "**/w11-clients-work.spec.ts",
        "**/workflow-plain-builder.spec.ts",
        "**/money.spec.ts",
        "**/money-tax.spec.ts",
        "**/secrets.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "integration",
      testMatch: [
        "**/first-reply-runtime.spec.ts",
        "**/agents.spec.ts",
        "**/agent-availability.spec.ts",
        "**/agent-snapshot-recipient.spec.ts",
        "**/onboarding.spec.ts",
        "**/onboarding-design.spec.ts",
        "**/onboarding-community-entry.spec.ts",
        "**/stream.spec.ts",
        "**/integration.spec.ts",
        "**/company-asks.live.spec.ts",
        "**/company-team.integration.spec.ts",
        "**/company-team.live.spec.ts",
        "**/company-work.live.spec.ts",
        "**/company-work.spec.ts",
        "**/dm-double-notification.spec.ts",
        "**/profile.spec.ts",
        "**/sidebar.spec.ts",
        "**/sidebar-relay-card.spec.ts",
        "**/tokens.spec.ts",
        "**/persona-env-vars.spec.ts",
        "**/persona-sync.spec.ts",
        "**/team-snapshot.spec.ts",
        "**/team-catalog.spec.ts",
        "**/agents-everywhere.live.spec.ts",
        "**/relay-restart.live.spec.ts",
        "**/goals.live.spec.ts",
        "**/parity-ancestor-island.spec.ts",
        "**/workflow-plain-builder.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
      },
      expect: {
        timeout: process.env.CI ? 15_000 : 10_000,
      },
    },
    ...canaryProjects,
  ],
  webServer: {
    command: `python3 -m http.server ${appPort} -d dist`,
    cwd: ".",
    reuseExistingServer: !process.env.CI,
    url: `http://127.0.0.1:${appPort}`,
  },
});
