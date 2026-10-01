import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

type E2eWindow = Window & {
  __BUZZ_E2E_COMMANDS__?: string[];
  __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
    command: string;
    payload: { request?: { mode?: string; modelId?: string } } | null;
  }>;
  __BUZZ_E2E_SET_MESH__?: (mesh: {
    models?: Array<{ id: string; name: string | null }>;
    nodeState?: "off" | "starting" | "running";
    nodeMode?: "serve" | "client" | null;
    hosts?: Array<{ id: string; name: string; local: boolean }>;
    hostsError?: string | null;
    hostsHold?: boolean;
    catalogInstalled?: boolean;
    catalogError?: string | null;
    statusError?: string | null;
    startError?: string | null;
  }) => void;
};

test("Share compute keeps the selected model after a failed start", async ({
  page,
}) => {
  const modelRef = "hf://demo/SmolLM2-135M-Instruct-GGUF:Q4_K_M";
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "compute");

  const card = page.getByTestId("settings-mesh-share-compute");
  const model = page.getByLabel("Or a supported model reference");
  const start = page.getByRole("button", { name: "Start sharing" });

  await expect(card).toContainText("Sharing is off");
  await expect(
    page.getByTestId("mesh-share-compute-options-motion"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("mesh-share-compute-sharing-status"),
  ).toHaveCount(0);
  await expect(page.getByTestId("mesh-connected-host")).toHaveCount(0);
  await expect(model).toBeVisible();
  await expect(start).toBeDisabled();
  await model.fill(modelRef);

  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      startError: "temporary sharing failure",
    });
  });
  await start.click();
  await expect(card).toContainText("Could not save");
  await expect(card).toContainText(
    "Your inputs are kept. Review them or retry without starting again.",
  );
  await expect(model).toHaveValue(modelRef);
  await expect(page.getByTestId("mesh-share-compute-state")).toContainText(
    "Sharing is off",
  );

  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({ startError: null });
  });

  await start.click();
  await expect(page.getByTestId("mesh-share-compute-state")).toContainText(
    "Sharing is active",
  );
  await expect(card).toContainText("SmolLM2 135M");
  await expect(page.getByTestId("mesh-share-compute-stop")).toBeVisible();
  await expect(page.getByTestId("mesh-connected-host")).toContainText(
    "Local test host",
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? []),
    )
    .toContain("mesh_start_node");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as E2eWindow).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
      ),
    )
    .toContainEqual({
      command: "mesh_start_node",
      payload: {
        request: { mode: "serve", modelId: modelRef },
      },
    });

  await page.getByTestId("mesh-share-compute-stop").click();
  await expect(page.getByTestId("mesh-share-compute-state")).toContainText(
    "Sharing is off",
  );
  await expect(model).toBeVisible();
  await expect(page.getByTestId("mesh-connected-host")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? []),
    )
    .toContain("mesh_stop_node");
});

test("connected hosts show returned records and distinguish load failure from empty", async ({
  page,
}) => {
  const modelDraft = "hf://demo/local-model:Q4_K_M";
  await page.addInitScript((model) => {
    window.localStorage.setItem("buzz.mesh-compute.share.model.v1", model);
  }, modelDraft);
  await installMockBridge(page);
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as E2eWindow).__BUZZ_E2E_SET_MESH__ === "function",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      hostsError: "temporary host query failure",
    });
  });
  await openSettings(page, "compute");

  await expect(page.getByTestId("settings-mesh-unavailable")).toBeVisible();
  await expect(page.getByTestId("settings-mesh-compute")).toHaveCount(0);
  await expect(
    page.getByText(
      "A connection failure is not an empty record. Your draft is kept.",
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      hostsError: null,
      hosts: [
        {
          id: "test-remote-host",
          name: "Remote test workstation",
          local: false,
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByTestId("settings-mesh-compute")).toBeVisible();
  await expect(page.getByTestId("mesh-connected-host")).toContainText(
    "Remote test workstation",
  );
  await expect(page.getByTestId("mesh-connected-host")).toContainText(
    "Remote · Available",
  );
  await expect(page.getByLabel("Or a supported model reference")).toHaveValue(
    modelDraft,
  );
  await expect(page.getByTestId("settings-mesh-compute")).not.toContainText(
    "test-remote-host",
  );
  await expect(page.getByTestId("settings-mesh-compute")).not.toContainText(
    "This Mac",
  );
});

test("Mesh loading and empty results do not fabricate a host or model", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as E2eWindow).__BUZZ_E2E_SET_MESH__ === "function",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      hostsHold: true,
      catalogInstalled: false,
      models: [],
    });
  });
  await openSettings(page, "compute");

  await expect(page.getByTestId("settings-mesh-loading")).toContainText(
    "Loading the latest record",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({ hostsHold: false });
  });
  await expect(page.getByTestId("settings-mesh-compute")).toBeVisible();
  await expect(page.getByText("No installed model found")).toBeVisible();
  await expect(page.getByTestId("mesh-connected-host")).toHaveCount(0);
  await expect(page.getByLabel("Or a supported model reference")).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "Start sharing" }),
  ).toBeDisabled();
  await expect(page.getByTestId("settings-mesh-compute")).not.toContainText(
    "This Mac",
  );
});

test("startup hides model controls and is not shown as active", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as E2eWindow).__BUZZ_E2E_SET_MESH__ === "function",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      nodeState: "starting",
      nodeMode: "serve",
    });
  });
  await openSettings(page, "compute");

  await expect(page.getByTestId("mesh-share-compute-state")).toContainText(
    "Starting sharing",
  );
  await expect(page.getByTestId("mesh-share-compute-state")).toContainText(
    "Other people cannot use this device yet.",
  );
  await expect(page.getByTestId("mesh-share-compute-stop")).toHaveCount(0);
  await expect(page.getByTestId("mesh-share-compute-catalog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start sharing" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Cancel startup" }),
  ).toHaveCount(0);
});

test("a consuming client can switch to sharing its saved local model", async ({
  page,
}) => {
  // Regression: consuming someone else's shared compute starts a client-mode
  // node in the single runtime slot, which reports state:"running". The Share
  // toggle keyed off state alone and lit up. A later guard overcorrected by
  // disabling the switch and copying the remote model over the local sharing
  // choice. Keep the switch off, preserve the local model, then replace the
  // client with one serve start (never a stop command).
  const localModel = "hf://demo/local-small-model:Q4_K_M";
  await page.addInitScript((model) => {
    window.localStorage.setItem("buzz.mesh-compute.share.model.v1", model);
  }, localModel);
  await installMockBridge(page);
  await page.goto("/");
  // The mesh seed hook is installed when the mock bridge boots; calling it
  // before then silently no-ops (optional chaining) and the seed is lost.
  await page.waitForFunction(
    () => typeof (window as E2eWindow).__BUZZ_E2E_SET_MESH__ === "function",
  );
  await page.evaluate(() => {
    (window as E2eWindow).__BUZZ_E2E_SET_MESH__?.({
      nodeState: "running",
      nodeMode: "client",
    });
  });
  await openSettings(page, "compute");

  const card = page.getByTestId("settings-mesh-share-compute");
  const toggle = page.getByTestId("mesh-share-compute-toggle");
  await expect(card).toContainText(
    "This machine is currently using another member's shared compute",
  );
  await expect(card).toContainText("Buzz may briefly restart");
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByTestId("mesh-share-compute-options-motion"),
  ).toHaveCount(0);
  await expect(toggle).toBeEnabled();
  const customModel = page.getByLabel("Custom model reference");
  await expect(customModel).toHaveValue(localModel);
  await customModel.fill("");
  await expect(customModel).toBeVisible();
  await customModel.fill("hf://demo/replacement-model:Q4_K_M");
  await toggle.click();
  await expect(toggle).toBeChecked();

  const commands = await page.evaluate(() => ({
    names: (window as E2eWindow).__BUZZ_E2E_COMMANDS__ ?? [],
    payloads: (window as E2eWindow).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  }));
  expect(commands.names).not.toContain("mesh_stop_node");
  expect(commands.payloads).toContainEqual({
    command: "mesh_start_node",
    payload: {
      request: { mode: "serve", modelId: "hf://demo/replacement-model:Q4_K_M" },
    },
  });
});
