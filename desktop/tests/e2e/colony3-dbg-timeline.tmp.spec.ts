import { readFileSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForCompanyWorkThreadContextRead } from "../helpers/companyWork";
import { expectCornerRadiusPx, expectSmoothCorners } from "../helpers/css";
import { openAvatarProfileContext, openSettings } from "../helpers/settings";

const LINK_PREVIEW_IMAGE = readFileSync(
  new URL("../fixtures/github-pr-5629-og.png", import.meta.url),
);
const LINK_PREVIEW_IMAGE_DATA_URL = `data:image/png;base64,${LINK_PREVIEW_IMAGE.toString("base64")}`;

async function waitForReadyComposerSnapshots(
  page: import("@playwright/test").Page,
  count = 1,
) {
  await expect(page.locator("[data-composer-link-previews]")).toHaveAttribute(
    "data-ready-snapshot-count",
    String(count),
  );
}

// Edit starts only when Radix finishes closing. An enabled reply input is
// not evidence that edit content/focus (and the navigation guard) are ready.
async function expectReplyEditReady(threadPanel: Locator, content: string) {
  await expect(threadPanel.getByTestId("edit-target")).toBeVisible();
  const input = threadPanel.getByTestId("message-input");
  await expect(input).toHaveText(content);
  await expect(input).toBeFocused();
}

async function expectThreadReplyUnobscured(row: Locator) {
  await expect
    .poll(async () =>
      row.evaluate((element) => {
        const threadBody = element.closest(
          '[data-testid="message-thread-body"]',
        ) as HTMLElement | null;
        const threadPanel = element.closest(
          '[data-testid="message-thread-panel"]',
        ) as HTMLElement | null;
        const composer = threadPanel?.querySelector<HTMLElement>(
          '[data-testid="message-input"]',
        );
        if (!threadBody || !composer) return false;

        const rowRect = element.getBoundingClientRect();
        const bodyRect = threadBody.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const visibleBottom = Math.min(bodyRect.bottom, composerRect.top);
        return (
          rowRect.top >= bodyRect.top - 1 && rowRect.bottom <= visibleBottom + 1
        );
      }),
    )
    .toBe(true);
}

async function measureThreadSummaryGeometry(summaryRow: Locator) {
  return summaryRow.evaluate((summaryButton) => {
    const summaryWrapper = summaryButton.parentElement;
    const container = summaryWrapper?.parentElement;
    const messageRow = container?.querySelector<HTMLElement>(
      '[data-testid="message-row"]',
    );
    const messageMarkdown =
      messageRow?.querySelector<HTMLElement>(".message-markdown");
    const messageAuthor = messageRow?.querySelector<HTMLElement>(
      '[data-testid="message-author"]',
    );
    const firstParticipant = summaryButton.querySelector<HTMLElement>(
      '[data-testid="message-thread-summary-participant"]',
    );
    const summarySurface = summaryButton.querySelector<HTMLElement>(
      '[data-testid="message-thread-summary-surface"]',
    );
    const firstAvatar = firstParticipant?.querySelector<HTMLElement>(
      '[data-testid^="message-thread-summary-avatar-"]',
    );

    if (
      !summaryWrapper ||
      !container ||
      !messageRow ||
      !messageAuthor ||
      !messageMarkdown ||
      !summarySurface ||
      !(firstAvatar instanceof HTMLElement)
    ) {
      throw new Error("Expected measurable thread summary geometry.");
    }

    const containerRect = container.getBoundingClientRect();
    const messageRowRect = messageRow.getBoundingClientRect();
    const messageAuthorRect = messageAuthor.getBoundingClientRect();
    const messageMarkdownRect = messageMarkdown.getBoundingClientRect();
    const summaryButtonRect = summaryButton.getBoundingClientRect();
    const summaryButtonStyle = getComputedStyle(summaryButton);
    const summaryButtonPaddingLeft = Number.parseFloat(
      summaryButtonStyle.paddingLeft,
    );
    const summaryWrapperRect = summaryWrapper.getBoundingClientRect();
    const firstAvatarRect = firstAvatar.getBoundingClientRect();
    const summarySurfaceRect = summarySurface.getBoundingClientRect();

    return {
      authorLeft: messageAuthorRect.left,
      avatarLeft: firstAvatarRect.left,
      bodyLeft: messageMarkdownRect.left,
      bottomPadding: containerRect.bottom - summaryWrapperRect.bottom,
      messageRowLeft: messageRowRect.left,
      summaryButtonContentLeft:
        summaryButtonRect.left + summaryButtonPaddingLeft,
      summaryButtonLeft: summaryButtonRect.left,
      summaryButtonPaddingLeft,
      summarySurfaceLeft: summarySurfaceRect.left,
      topPadding: messageRowRect.top - containerRect.top,
    };
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  const baseMock = testInfo.title.includes("agent owner label")
    ? {
        searchProfiles: [
          {
            pubkey: TEST_IDENTITIES.alice.pubkey,
            displayName: "alice",
            ownerPubkey: TEST_IDENTITIES.bob.pubkey,
            isAgent: true,
          },
          {
            pubkey: TEST_IDENTITIES.bob.pubkey,
            displayName: "bob",
          },
        ],
      }
    : testInfo.title.includes("cardless short tweet preview")
      ? {
          linkPreviewMetadata: {
            title: "jack (@jack) on X",
            siteName: "X (formerly Twitter)",
            description: "just setting up my twttr",
            imageDataUrl: null,
            imageDomain: null,
          },
        }
      : testInfo.title.includes("cardless tweet preview")
        ? {
            linkPreviewMetadata: {
              title: "Buzz (@buzz) on X",
              siteName: "X (formerly Twitter)",
              description:
                "This is a real tweet-style description long enough to wrap across several lines while preserving the message-like treatment. It keeps going with enough distinct words to exceed five rendered lines at the preview width, proving that the overflow-aware control appears only when the content is genuinely clipped rather than relying on a brittle character-count guess.",
              imageDataUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675'%3E%3Crect width='1200' height='675' fill='%231d9bf0'/%3E%3C/svg%3E",
              imageDomain: "pbs.twimg.com",
            },
          }
        : testInfo.title.includes("fragment link previews")
          ? {
              // Metadata is keyed by the canonical, fragment-less URL - the
              // shape a real OpenGraph/HTML fetch resolves against. A resolver
              // that fetches with the raw `#fragment` attached would miss these
              // keys and drop the card, which is exactly the bug under test.
              linkPreviewMetadataByHref: {
                "https://github.com/block/buzz/pull/3767": {
                  title: "Buzz pull request 3767",
                  siteName: "GitHub",
                  description: "Fragment-bearing PR link.",
                  imageDataUrl: null,
                  imageDomain: null,
                },
                "https://github.com/block/buzz/pull/3867": {
                  title: "Buzz pull request 3867",
                  siteName: "GitHub",
                  description: "Plain PR link.",
                  imageDataUrl: null,
                  imageDomain: null,
                },
              },
            }
          : testInfo.title.includes("mixed") &&
              testInfo.title.includes("link preview image outcomes")
            ? {
                linkPreviewMetadataByHref: {
                  "https://github.com/block/buzz/pull/4001": {
                    title: "Loaded preview image",
                    siteName: "GitHub",
                    description: "The image request completed.",
                    imageDataUrl:
                      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                    imageDomain: "opengraph.githubassets.com",
                    imageFetchState: "image",
                    imageRetryAfterMs: null,
                  },
                  "https://github.com/block/buzz/pull/4002": {
                    title: "Rate-limited preview image",
                    siteName: "GitHub",
                    description: "Metadata remains available during cooldown.",
                    imageDataUrl: null,
                    imageDomain: null,
                    imageFetchState: "transient_failure",
                    imageRetryAfterMs: 900_000,
                  },
                },
              }
            : testInfo.title.includes("link preview browser image error")
              ? {
                  linkPreviewMetadata: {
                    title: "Invalid decoded preview image",
                    siteName: "GitHub",
                    description: "The browser should replace this image.",
                    imageDataUrl: null,
                    imageDomain: null,
                    imageFetchState: "rejected",
                    imageRetryAfterMs: null,
                  },
                }
              : testInfo.title.includes("link preview image geometry")
                ? {
                    linkPreviewMetadata: {
                      title:
                        "Ship a wider horizontal preview with a two-line title that wraps cleanly",
                      siteName: "GitHub",
                      description:
                        "A polished, stable preview for shared links.",
                      imageDataUrl: LINK_PREVIEW_IMAGE_DATA_URL,
                      imageDomain: "opengraph.githubassets.com",
                      faviconDataUrl:
                        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                    },
                    linkPreviewMetadataDelayMs: 800,
                  }
                : testInfo.title.includes("link preview no-image layout") ||
                    testInfo.title.includes("composer no-image link embeds")
                  ? {
                      linkPreviewMetadata: {
                        title: "Colony",
                        siteName: "GitHub",
                        description:
                          "Open-source collaboration for the Buzz app.",
                        imageDataUrl: null,
                        imageDomain: null,
                        faviconDataUrl:
                          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                      },
                      linkPreviewMetadataDelayMs: 2_000,
                    }
                  : testInfo.title.includes(
                        "rich link preview preserves description newlines",
                      )
                    ? {
                        linkPreviewMetadata: {
                          title: "Buzz pull request",
                          siteName: "GitHub",
                          description:
                            "First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.",
                          imageDataUrl: null,
                          imageDomain: null,
                        },
                      }
                    : testInfo.title.includes(
                          "Enter during an in-flight snapshot upload",
                        ) ||
                        testInfo.title.includes("Skip wins the upload race") ||
                        testInfo.title.includes(
                          "async metadata beyond old cutoff",
                        ) ||
                        testInfo.title.includes(
                          "async upload beyond metadata budget",
                        ) ||
                        testInfo.title.includes(
                          "immediately pressing Enter prepares",
                        )
                      ? {
                          linkPreviewMetadata: {
                            title: "Buzz pull request",
                            siteName: "GitHub",
                            description: "A sender-authored preview snapshot.",
                            imageDataUrl:
                              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                            imageDomain: "opengraph.githubassets.com",
                          },
                          linkPreviewMetadataDelayMs: testInfo.title.includes(
                            "async metadata beyond old cutoff",
                          )
                            ? 4_000
                            : 300,
                          linkPreviewUploadDelayMs: testInfo.title.includes(
                            "async upload beyond metadata budget",
                          )
                            ? 4_000
                            : 1_200,
                        }
                      : testInfo.title.includes(
                            "snapshot thumbnail upload failure",
                          ) ||
                          testInfo.title.includes(
                            "snapshot media upload failure",
                          )
                        ? {
                            linkPreviewMetadata: {
                              title: "Buzz pull request",
                              siteName: "GitHub",
                              description:
                                "A sender-authored preview snapshot.",
                              imageDataUrl:
                                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                              imageDomain: "opengraph.githubassets.com",
                              faviconDataUrl:
                                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                            },
                            // Fail only the thumbnail upload; the favicon survives,
                            // so the snapshot degrades to a favicon-only preview.
                            linkPreviewUploadErrorFilenames: [
                              "link-preview-image",
                            ],
                          }
                        : testInfo.title.includes(
                              "link preview media uses the authenticated proxy",
                            )
                          ? {
                              mediaProxyInitiallyUnavailable: true,
                              linkPreviewMetadata: {
                                title: "Buzz pull request",
                                siteName: "GitHub",
                                description:
                                  "A sender-authored preview snapshot.",
                                imageDataUrl:
                                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                                imageDomain: "opengraph.githubassets.com",
                                faviconDataUrl:
                                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                              },
                            }
                          : testInfo.title.includes("link preview") ||
                              testInfo.title.includes("supported Compact")
                            ? {
                                linkPreviewMetadata: {
                                  title: "Buzz pull request",
                                  siteName: "GitHub",
                                  description:
                                    "A sender-authored preview snapshot.",
                                  imageDataUrl: null,
                                  imageDomain: null,
                                },
                                linkPreviewMetadataDelayMs:
                                  testInfo.title.includes(
                                    "loading card before cold resolver work",
                                  )
                                    ? 10_000
                                    : testInfo.title.includes(
                                          "explicit cancellation suppresses a pending",
                                        ) ||
                                        testInfo.title.includes(
                                          "settled-empty promoted link preview",
                                        )
                                      ? 10_000
                                      : testInfo.title.includes(
                                            "draft auto-send",
                                          )
                                        ? 500
                                        : testInfo.title.includes(
                                              "style defaults",
                                            ) ||
                                            testInfo.title.includes(
                                              "style unfurls descriptions",
                                            ) ||
                                            testInfo.title.includes(
                                              "attachment-sized",
                                            )
                                          ? 1_500
                                          : undefined,
                                linkPreviewMetadataStartBlockMs:
                                  testInfo.title.includes(
                                    "loading card before cold resolver work",
                                  )
                                    ? 150
                                    : undefined,
                              }
                            : undefined;
  const mock = testInfo.title.includes("unresolvable preview")
    ? { linkPreviewMetadata: null, linkPreviewMetadataDelayMs: 800 }
    : {
        ...baseMock,
        ...(testInfo.title.includes("clears Sending after")
          ? { sendMessageDelayMs: 800 }
          : {}),
      };
  await installMockBridge(page, mock);
});

test.beforeEach(async ({ page }, testInfo) => {
  const baseMock = testInfo.title.includes("agent owner label")
    ? {
        searchProfiles: [
          {
            pubkey: TEST_IDENTITIES.alice.pubkey,
            displayName: "alice",
            ownerPubkey: TEST_IDENTITIES.bob.pubkey,
            isAgent: true,
          },
          {
            pubkey: TEST_IDENTITIES.bob.pubkey,
            displayName: "bob",
          },
        ],
      }
    : testInfo.title.includes("cardless short tweet preview")
      ? {
          linkPreviewMetadata: {
            title: "jack (@jack) on X",
            siteName: "X (formerly Twitter)",
            description: "just setting up my twttr",
            imageDataUrl: null,
            imageDomain: null,
          },
        }
      : testInfo.title.includes("cardless tweet preview")
        ? {
            linkPreviewMetadata: {
              title: "Buzz (@buzz) on X",
              siteName: "X (formerly Twitter)",
              description:
                "This is a real tweet-style description long enough to wrap across several lines while preserving the message-like treatment. It keeps going with enough distinct words to exceed five rendered lines at the preview width, proving that the overflow-aware control appears only when the content is genuinely clipped rather than relying on a brittle character-count guess.",
              imageDataUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675'%3E%3Crect width='1200' height='675' fill='%231d9bf0'/%3E%3C/svg%3E",
              imageDomain: "pbs.twimg.com",
            },
          }
        : testInfo.title.includes("fragment link previews")
          ? {
              // Metadata is keyed by the canonical, fragment-less URL - the
              // shape a real OpenGraph/HTML fetch resolves against. A resolver
              // that fetches with the raw `#fragment` attached would miss these
              // keys and drop the card, which is exactly the bug under test.
              linkPreviewMetadataByHref: {
                "https://github.com/block/buzz/pull/3767": {
                  title: "Buzz pull request 3767",
                  siteName: "GitHub",
                  description: "Fragment-bearing PR link.",
                  imageDataUrl: null,
                  imageDomain: null,
                },
                "https://github.com/block/buzz/pull/3867": {
                  title: "Buzz pull request 3867",
                  siteName: "GitHub",
                  description: "Plain PR link.",
                  imageDataUrl: null,
                  imageDomain: null,
                },
              },
            }
          : testInfo.title.includes("mixed") &&
              testInfo.title.includes("link preview image outcomes")
            ? {
                linkPreviewMetadataByHref: {
                  "https://github.com/block/buzz/pull/4001": {
                    title: "Loaded preview image",
                    siteName: "GitHub",
                    description: "The image request completed.",
                    imageDataUrl:
                      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                    imageDomain: "opengraph.githubassets.com",
                    imageFetchState: "image",
                    imageRetryAfterMs: null,
                  },
                  "https://github.com/block/buzz/pull/4002": {
                    title: "Rate-limited preview image",
                    siteName: "GitHub",
                    description: "Metadata remains available during cooldown.",
                    imageDataUrl: null,
                    imageDomain: null,
                    imageFetchState: "transient_failure",
                    imageRetryAfterMs: 900_000,
                  },
                },
              }
            : testInfo.title.includes("link preview browser image error")
              ? {
                  linkPreviewMetadata: {
                    title: "Invalid decoded preview image",
                    siteName: "GitHub",
                    description: "The browser should replace this image.",
                    imageDataUrl: null,
                    imageDomain: null,
                    imageFetchState: "rejected",
                    imageRetryAfterMs: null,
                  },
                }
              : testInfo.title.includes("link preview image geometry")
                ? {
                    linkPreviewMetadata: {
                      title:
                        "Ship a wider horizontal preview with a two-line title that wraps cleanly",
                      siteName: "GitHub",
                      description:
                        "A polished, stable preview for shared links.",
                      imageDataUrl: LINK_PREVIEW_IMAGE_DATA_URL,
                      imageDomain: "opengraph.githubassets.com",
                      faviconDataUrl:
                        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                    },
                    linkPreviewMetadataDelayMs: 800,
                  }
                : testInfo.title.includes("link preview no-image layout") ||
                    testInfo.title.includes("composer no-image link embeds")
                  ? {
                      linkPreviewMetadata: {
                        title: "Colony",
                        siteName: "GitHub",
                        description:
                          "Open-source collaboration for the Buzz app.",
                        imageDataUrl: null,
                        imageDomain: null,
                        faviconDataUrl:
                          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                      },
                      linkPreviewMetadataDelayMs: 2_000,
                    }
                  : testInfo.title.includes(
                        "rich link preview preserves description newlines",
                      )
                    ? {
                        linkPreviewMetadata: {
                          title: "Buzz pull request",
                          siteName: "GitHub",
                          description:
                            "First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.",
                          imageDataUrl: null,
                          imageDomain: null,
                        },
                      }
                    : testInfo.title.includes(
                          "Enter during an in-flight snapshot upload",
                        ) ||
                        testInfo.title.includes("Skip wins the upload race") ||
                        testInfo.title.includes(
                          "async metadata beyond old cutoff",
                        ) ||
                        testInfo.title.includes(
                          "async upload beyond metadata budget",
                        ) ||
                        testInfo.title.includes(
                          "immediately pressing Enter prepares",
                        )
                      ? {
                          linkPreviewMetadata: {
                            title: "Buzz pull request",
                            siteName: "GitHub",
                            description: "A sender-authored preview snapshot.",
                            imageDataUrl:
                              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                            imageDomain: "opengraph.githubassets.com",
                          },
                          linkPreviewMetadataDelayMs: testInfo.title.includes(
                            "async metadata beyond old cutoff",
                          )
                            ? 4_000
                            : 300,
                          linkPreviewUploadDelayMs: testInfo.title.includes(
                            "async upload beyond metadata budget",
                          )
                            ? 4_000
                            : 1_200,
                        }
                      : testInfo.title.includes(
                            "snapshot thumbnail upload failure",
                          ) ||
                          testInfo.title.includes(
                            "snapshot media upload failure",
                          )
                        ? {
                            linkPreviewMetadata: {
                              title: "Buzz pull request",
                              siteName: "GitHub",
                              description:
                                "A sender-authored preview snapshot.",
                              imageDataUrl:
                                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                              imageDomain: "opengraph.githubassets.com",
                              faviconDataUrl:
                                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                            },
                            // Fail only the thumbnail upload; the favicon survives,
                            // so the snapshot degrades to a favicon-only preview.
                            linkPreviewUploadErrorFilenames: [
                              "link-preview-image",
                            ],
                          }
                        : testInfo.title.includes(
                              "link preview media uses the authenticated proxy",
                            )
                          ? {
                              mediaProxyInitiallyUnavailable: true,
                              linkPreviewMetadata: {
                                title: "Buzz pull request",
                                siteName: "GitHub",
                                description:
                                  "A sender-authored preview snapshot.",
                                imageDataUrl:
                                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                                imageDomain: "opengraph.githubassets.com",
                                faviconDataUrl:
                                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                              },
                            }
                          : testInfo.title.includes("link preview") ||
                              testInfo.title.includes("supported Compact")
                            ? {
                                linkPreviewMetadata: {
                                  title: "Buzz pull request",
                                  siteName: "GitHub",
                                  description:
                                    "A sender-authored preview snapshot.",
                                  imageDataUrl: null,
                                  imageDomain: null,
                                },
                                linkPreviewMetadataDelayMs:
                                  testInfo.title.includes(
                                    "loading card before cold resolver work",
                                  )
                                    ? 10_000
                                    : testInfo.title.includes(
                                          "explicit cancellation suppresses a pending",
                                        ) ||
                                        testInfo.title.includes(
                                          "settled-empty promoted link preview",
                                        )
                                      ? 10_000
                                      : testInfo.title.includes(
                                            "draft auto-send",
                                          )
                                        ? 500
                                        : testInfo.title.includes(
                                              "style defaults",
                                            ) ||
                                            testInfo.title.includes(
                                              "style unfurls descriptions",
                                            ) ||
                                            testInfo.title.includes(
                                              "attachment-sized",
                                            )
                                          ? 1_500
                                          : undefined,
                                linkPreviewMetadataStartBlockMs:
                                  testInfo.title.includes(
                                    "loading card before cold resolver work",
                                  )
                                    ? 150
                                    : undefined,
                              }
                            : undefined;
  const mock = testInfo.title.includes("unresolvable preview")
    ? { linkPreviewMetadata: null, linkPreviewMetadataDelayMs: 800 }
    : {
        ...baseMock,
        ...(testInfo.title.includes("clears Sending after")
          ? { sendMessageDelayMs: 800 }
          : {}),
      };
  await installMockBridge(page, mock);
});

test("dbg timeline scroll thrash", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __tl: unknown[] };
    w.__tl = [];
    const log = (kind: string, el: Element, extra: unknown) => {
      if (
        !(el instanceof HTMLElement) ||
        el.getAttribute("data-testid") !== "message-timeline"
      )
        return;
      const stack = (new Error().stack ?? "")
        .split("\n")
        .slice(2, 6)
        .map((l) => l.trim().replace(/^at /, "").slice(0, 110));
      w.__tl.push({
        t: Math.round(performance.now()),
        kind,
        extra,
        st: Math.round(el.scrollTop),
        stack,
      });
    };
    for (const name of ["scrollTo", "scrollBy"] as const) {
      const orig = Element.prototype[name] as (...a: unknown[]) => void;
      (Element.prototype as unknown as Record<string, unknown>)[name] =
        function (this: Element, ...args: unknown[]) {
          log(name, this, args);
          return orig.apply(this, args);
        };
    }
    const origSI = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      ...args: unknown[]
    ) {
      const timeline = this.closest('[data-testid="message-timeline"]');
      if (timeline)
        log("scrollIntoView", timeline, [
          this.getAttribute("data-message-id") ?? this.tagName,
        ]);
      return origSI.apply(this, args as []);
    };
    const desc = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    );
    if (desc?.set && desc.get) {
      Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        get: desc.get,
        set(this: Element, v: number) {
          log("scrollTop=", this, v);
          desc.set?.call(this, v);
        },
      });
    }
  });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const timeline = page.getByTestId("message-timeline");
  const input = page.getByTestId("message-input").first();
  await input.fill(`https://example.com/${"a".repeat(180)}/path`);
  await page.getByTestId("send-message").first().click();
  await expect(timeline).toContainText("example.com");
  const samples: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    samples.push(
      JSON.stringify(
        await page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="message-timeline"]',
          ) as HTMLElement;
          const row = el.querySelector(
            '[data-testid="message-row"]',
          ) as HTMLElement | null;
          const cs = getComputedStyle(el);
          return {
            t: Math.round(performance.now()),
            st: Math.round(el.scrollTop),
            sh: el.scrollHeight,
            ch: el.clientHeight,
            pt: cs.paddingTop,
            chrome: getComputedStyle(document.documentElement).getPropertyValue(
              "--channel-top-chrome-height",
            ),
            comp: getComputedStyle(document.documentElement).getPropertyValue(
              "--composer-overlay-height",
            ),
            w1: row ? Math.round(row.getBoundingClientRect().top) : null,
            hov: document.querySelectorAll('[data-testid="message-row"]:hover')
              .length,
          };
        }),
      ),
    );
    await page.waitForTimeout(100);
  }
  console.log("DBGSAMPLES\n" + samples.join("\n"));
  console.log(
    "DBGEVENTS\n" +
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { __tl: unknown[] }).__tl,
        ),
      ),
  );
});
