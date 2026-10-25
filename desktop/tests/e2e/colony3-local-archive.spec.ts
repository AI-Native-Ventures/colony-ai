import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Preferences keeps ONE local-archive switch ("Keep a copy of messages on this
 * computer"). It drives the saved archive subscriptions the native sync task
 * listens for: off leaves nothing to archive and stays off across a restart,
 * on saves the defaults again.
 */
const OBSERVER_KIND = 24200;
const METRIC_KIND = 44200;
const SELF = "deadbeef".repeat(8);

const SEEDED = [
  {
    scope_type: "owner_p",
    scope_value: SELF,
    kinds: JSON.stringify([OBSERVER_KIND, METRIC_KIND]),
  },
  {
    scope_type: "channel_h",
    scope_value: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
    kinds: JSON.stringify([9]),
  },
];

type Row = { scope_type: string; scope_value: string; kinds: number[] };

function archiveSwitch(page: Page) {
  return page.getByTestId("local-archive-switch");
}

async function openPreferences(page: Page) {
  await page.goto("/#/settings?section=notifications");
  await expect(page.getByTestId("settings-notifications")).toBeVisible();
  await expect(page.getByTestId("settings-local-archive")).toBeVisible();
  await expect(archiveSwitch(page)).toBeEnabled();
  // Startup seeds the default-on subscriptions and records that choice; wait
  // for it so a click cannot race the seeding.
  await expect
    .poll(async () => choices(page))
    .toEqual({ observer: ["1"], metric: ["1"] });
}

/** What the archive would save right now: the rows the native sync reads. */
async function saved(page: Page): Promise<Row[]> {
  return page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;
    const rows = (await invoke("list_save_subscriptions")) as Array<
      Omit<Row, "kinds"> & { kinds: string | number[] }
    >;
    // The command returns the kinds column as JSON text.
    return rows.map((row) => ({
      ...row,
      kinds:
        typeof row.kinds === "string"
          ? (JSON.parse(row.kinds) as number[])
          : row.kinds,
    }));
  });
}

async function choices(page: Page) {
  return page.evaluate(() => {
    const read = (prefix: string) => {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith(prefix),
      );
      return keys.map((key) => localStorage.getItem(key));
    };
    return {
      observer: read("buzz:observer-archive-default-seeded:"),
      metric: read("buzz:agent-metric-archive-default-seeded:"),
    };
  });
}

test.describe("local archive switch", () => {
  test("is the only archive control in Settings and reads on by default", async ({
    page,
  }) => {
    await installMockBridge(page);
    await openPreferences(page);

    await expect(
      page.getByText("Keep a copy of messages on this computer", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("local-archive-switch")).toHaveCount(1);
    await expect(archiveSwitch(page)).toBeChecked();
    // The cut Storage page and its per-kind controls are not reachable.
    await expect(page.getByTestId("settings-local-archive-card")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("local-archive-observer-toggle")).toHaveCount(
      0,
    );
    await expect
      .poll(async () =>
        (await saved(page)).some((row) => row.kinds.includes(OBSERVER_KIND)),
      )
      .toBe(true);
  });

  test("off deletes every saved subscription, channel ones included", async ({
    page,
  }) => {
    await installMockBridge(page, { saveSubscriptions: SEEDED });
    await openPreferences(page);
    await expect(archiveSwitch(page)).toBeChecked();
    expect(await saved(page)).toHaveLength(2);

    await archiveSwitch(page).click();
    await expect(archiveSwitch(page)).not.toBeChecked();

    // Nothing is left for the archive to save, and the opt-out is remembered.
    expect(await saved(page)).toEqual([]);
    expect(await choices(page)).toEqual({ observer: ["0"], metric: ["0"] });
    await page.waitForTimeout(1500);
    expect(await saved(page)).toEqual([]);
  });

  test("a remembered opt-out is not seeded back when the app starts again", async ({
    page,
  }) => {
    // What a restart looks like after off: the archive holds no subscriptions
    // and the identity's opt-out is stored.
    await page.addInitScript((self) => {
      localStorage.setItem(`buzz:observer-archive-default-seeded:${self}`, "0");
      localStorage.setItem(
        `buzz:agent-metric-archive-default-seeded:${self}`,
        "0",
      );
    }, SELF);
    await installMockBridge(page, { saveSubscriptions: [] });
    await page.goto("/#/settings?section=notifications");
    await expect(archiveSwitch(page)).toBeEnabled();
    await expect(archiveSwitch(page)).not.toBeChecked();
    await page.waitForTimeout(2000);
    expect(await saved(page)).toEqual([]);
    await expect(archiveSwitch(page)).not.toBeChecked();
  });

  test("on saves the observer and metric defaults again", async ({ page }) => {
    await installMockBridge(page, { saveSubscriptions: SEEDED });
    await openPreferences(page);
    await archiveSwitch(page).click();
    await expect(archiveSwitch(page)).not.toBeChecked();
    expect(await saved(page)).toEqual([]);

    await archiveSwitch(page).click();
    await expect(archiveSwitch(page)).toBeChecked();
    const rows = await saved(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope_type: "owner_p", scope_value: SELF });
    expect([...rows[0].kinds].sort()).toEqual([OBSERVER_KIND, METRIC_KIND]);
    expect(await choices(page)).toEqual({ observer: ["1"], metric: ["1"] });
  });

  test("a failed change says so and the switch keeps showing what is saved", async ({
    page,
  }) => {
    await installMockBridge(page, { saveSubscriptions: SEEDED });
    await openPreferences(page);
    await expect(archiveSwitch(page)).toBeChecked();

    await page.evaluate(() => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              payload?: unknown,
              options?: unknown,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke.bind(internals);
      internals.invoke = async (command, payload, options) => {
        if (command === "delete_save_subscription")
          throw new Error("The archive is busy.");
        return original(command, payload, options);
      };
    });

    await archiveSwitch(page).click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not change the local archive",
    );
    await expect(archiveSwitch(page)).toBeChecked();
    expect(await saved(page)).toHaveLength(2);
    // The opt-out was not recorded, because nothing was turned off.
    expect((await choices(page)).observer).not.toContain("0");
    expect((await choices(page)).metric).not.toContain("0");
  });
});
