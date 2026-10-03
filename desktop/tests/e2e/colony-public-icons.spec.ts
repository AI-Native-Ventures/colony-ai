import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { selectSettingsSection } from "../helpers/settings";

async function assertQrIcon(qr: Locator) {
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("width", "240");
  await expect(qr).toHaveAttribute("height", "240");
  const icon = qr.locator("image");
  await expect(icon).toHaveAttribute("href", "/app-icon@2x.png");
  const dimensions = await qr.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const image = svg.querySelector("image") as SVGImageElement;
    return {
      matrix: Number(svg.dataset.qrMatrixSize),
      width: image.width.baseVal.value,
      height: image.height.baseVal.value,
    };
  });
  const maximum = Math.floor(Math.sqrt(dimensions.matrix ** 2 * 0.1));
  const center = maximum % 2 === 0 ? maximum - 1 : maximum;
  expect(dimensions.width).toBeCloseTo(center * 0.8, 6);
  expect(dimensions.height).toBeCloseTo(center * 0.8, 6);
}

async function capture(page: Page, name: string) {
  await waitForAnimations(page);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test("mobile pairing retains the Colony icon and QR dimensions", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await selectSettingsSection(page, "mobile");
  await page.getByTestId("start-pairing-button").click();
  await assertQrIcon(page.getByTestId("mobile-pairing-qr"));
  await capture(page, "mobile-pairing");
});

test("bind consent loads the Colony icon at its existing size", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("channel-general")).toBeVisible();
  await page.evaluate(async () => {
    const internals = (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Mock event bridge is unavailable");
    await internals.invoke("plugin:event|emit", {
      event: "deep-link-nostr-bind",
      payload: {
        action: "bind_nostr_identity",
        audience: "buzz:nostr-identity",
        challengeId: "550e8400-e29b-41d4-a716-446655440000",
        expiresAt: "2099-01-01T00:00:00Z",
        nonce: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
        origin: "https://admin.example.com",
        protocol: "buzz-nostr-identity",
        returnMode: "clipboard",
        verificationCode: "123456",
        version: "1",
      },
    });
  });
  const icon = page
    .getByTestId("nostr-bind-page")
    .getByRole("img", { name: "Colony", exact: true });
  await expect(icon).toBeVisible();
  const size = await icon.evaluate((element) => {
    const image = element as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return {
      complete: image.complete,
      natural: image.naturalWidth,
      width: box.width,
      height: box.height,
      rem: Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      ),
    };
  });
  expect(size.complete).toBe(true);
  expect([112, 168]).toContain(size.natural);
  expect(size.width).toBeCloseTo(size.rem * 3.5, 2);
  expect(size.height).toBeCloseTo(size.rem * 3.5, 2);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/colony-icon.svg",
  );
  await capture(page, "bind-consent");
});
