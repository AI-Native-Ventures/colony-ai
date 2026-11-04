import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/lockedBrowserTest";
import { installMockBridge } from "../helpers/bridge";

const PROJECT_ID = "b9517e2d-46d3-493d-9e46-aed2c6320505";
const REVIEW_PREVIEW = `<!doctype html><html><body><h1>North Star Studio</h1><p>Private visual preview.</p></body></html>`;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBgAAAABJRU5ErkJggg==";

type DesignReviewState = {
  actions: Array<{
    projectId: string;
    action: string;
    feedback: string | null;
  }>;
  review: string;
  feedback: string | null;
};

async function installDesignReviewMock(page: Page) {
  await page.evaluate(
    ({ projectId, previewHtml, png }) => {
      const state: DesignReviewState = {
        actions: [],
        review: "pending",
        feedback: null,
      };
      const windowWithDesign = window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
        };
        __BUZZ_E2E_DESIGN_REVIEW__?: DesignReviewState;
      };
      const internals = windowWithDesign.__TAURI_INTERNALS__;
      if (!internals) throw new Error("The mocked Tauri bridge is unavailable");
      const original = internals.invoke.bind(internals);
      windowWithDesign.__BUZZ_E2E_DESIGN_REVIEW__ = state;
      const readReview = () => ({
        projectId,
        title: "North Star Studio landing page",
        status: "ready_for_review",
        review: state.review,
        previewHtml,
        thumbnails: [
          { name: "desktop-1440.png", dataUrl: png },
          { name: "mobile-390.png", dataUrl: png },
        ],
        feedback: state.feedback,
      });
      internals.invoke = (command, args) => {
        const payload = (args ?? {}) as {
          projectId?: string;
          action?: string;
          feedback?: string | null;
        };
        if (command === "get_colony_design_review")
          return Promise.resolve(readReview());
        if (command === "review_colony_design") {
          if (payload.projectId !== projectId)
            throw new Error("Wrong project id");
          state.actions.push({
            projectId,
            action: payload.action ?? "",
            feedback: payload.feedback ?? null,
          });
          state.review =
            payload.action === "approve" ? "approved" : "changes_requested";
          state.feedback =
            payload.action === "changes" ? (payload.feedback ?? null) : null;
          return Promise.resolve(readReview());
        }
        return original(command, args);
      };
    },
    { projectId: PROJECT_ID, previewHtml: REVIEW_PREVIEW, png: PNG },
  );
}

async function emitDesignReviewCard(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ projectId }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: JSON.stringify({
          type: "colony-design-review",
          projectId,
          title: "North Star Studio landing page",
          runtime: "colony-buzz-agent",
          status: "ready_for_review",
        }),
        pubkey: "deadbeef".repeat(8),
        kind: 9,
        extraTags: [["colony-design", projectId]],
        createdAt: Math.floor(Date.now() / 1000),
      });
    },
    { projectId: PROJECT_ID },
  );
}

test("design review card opens the private preview and supports owner review", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await installDesignReviewMock(page);
  await emitDesignReviewCard(page);

  const card = page.getByTestId("design-review-card");
  await expect(card).toContainText("Open Design");
  await expect(card).toContainText("Private on this computer");
  await card.getByRole("button", { name: "Review design" }).click();

  const panel = page.getByTestId("design-review-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("North Star Studio landing page");
  await expect(
    panel.getByAltText("Design screenshot desktop-1440.png"),
  ).toBeVisible();
  await expect(
    panel.getByAltText("Design screenshot mobile-390.png"),
  ).toBeVisible();
  const preview = page.getByTestId("design-preview-frame");
  await expect(preview).toHaveAttribute("sandbox", "");
  await expect(preview).toHaveAttribute("srcdoc", /Private visual preview/);

  await panel
    .getByTestId("design-feedback-input")
    .fill("Increase the hero contrast.");
  await panel.getByTestId("design-request-changes").click();
  await expect(panel.getByTestId("design-review-feedback")).toContainText(
    "Increase the hero contrast.",
  );
  await panel.getByTestId("design-approve").click();
  await expect(panel).toContainText(
    "Approved. Your agent can use this design as its source.",
  );
  await expect(panel.getByTestId("design-approve")).toHaveCount(0);
  const actions = await page.evaluate(
    () => window.__BUZZ_E2E_DESIGN_REVIEW__?.actions ?? [],
  );
  expect(actions).toEqual([
    {
      projectId: PROJECT_ID,
      action: "changes",
      feedback: "Increase the hero contrast.",
    },
    { projectId: PROJECT_ID, action: "approve", feedback: null },
  ]);
});
