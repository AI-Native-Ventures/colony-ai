import assert from "node:assert/strict";
import test from "node:test";
import { createElectronDialogs } from "./dialogs.mjs";

function harness({ openResult, saveResult }) {
  const calls = [];
  const window = { isDestroyed: () => false };
  const dialog = {
    showOpenDialog: async (...args) => {
      calls.push(["open", ...args]);
      return openResult;
    },
    showSaveDialog: async (...args) => {
      calls.push(["save", ...args]);
      return saveResult;
    },
  };
  return {
    calls,
    dialogs: createElectronDialogs({ dialog, getWindow: () => window }),
    window,
  };
}

test("open dialog is parented to its calling window and returns the selected path", async () => {
  const state = harness({
    openResult: { canceled: false, filePaths: ["/tmp/attachment.png"] },
  });
  assert.equal(state.dialogs.handles("plugin:dialog|open"), true);
  assert.equal(
    await state.dialogs.invoke("plugin:dialog|open", {
      options: {
        title: "Attach an image",
        defaultPath: "/tmp",
        filters: [{ name: "Images", extensions: ["png", 4, "jpg"] }],
      },
    }),
    "/tmp/attachment.png",
  );
  assert.deepEqual(state.calls, [
    [
      "open",
      state.window,
      {
        title: "Attach an image",
        defaultPath: "/tmp",
        filters: [{ name: "Images", extensions: ["png", "jpg"] }],
        properties: ["openFile"],
      },
    ],
  ]);
});

test("multiple and directory selections preserve Tauri result shapes", async () => {
  const state = harness({
    openResult: {
      canceled: false,
      filePaths: ["/tmp/one.png", "/tmp/two.png"],
    },
  });
  assert.deepEqual(
    await state.dialogs.invoke("plugin:dialog|open", {
      directory: true,
      multiple: true,
      showHiddenFiles: true,
    }),
    ["/tmp/one.png", "/tmp/two.png"],
  );
  assert.equal(state.calls[0][1], state.window);
  assert.deepEqual(state.calls[0][2], {
    title: undefined,
    defaultPath: undefined,
    filters: undefined,
    properties: ["openDirectory", "multiSelections", "showHiddenFiles"],
  });
});

test("save dialog returns its path and cancellation returns null", async () => {
  const state = harness({
    openResult: { canceled: true, filePaths: [] },
    saveResult: { canceled: false, filePath: "/tmp/backup.ncryptsec" },
  });
  assert.equal(
    await state.dialogs.invoke("plugin:dialog|save", {
      title: "Save backup",
      defaultPath: "/tmp/backup.ncryptsec",
      filters: [{ name: "Key backup", extensions: ["ncryptsec"] }],
    }),
    "/tmp/backup.ncryptsec",
  );
  assert.equal(
    await state.dialogs.invoke("plugin:dialog|open", { options: {} }),
    null,
  );
  assert.deepEqual(state.calls[0][2], {
    title: "Save backup",
    defaultPath: "/tmp/backup.ncryptsec",
    filters: [{ name: "Key backup", extensions: ["ncryptsec"] }],
    nameFieldLabel: undefined,
    showsTagField: false,
  });
});
