import assert from "node:assert/strict";
import test from "node:test";

import {
  selectActiveThreadRootId,
  shouldPrioritizeIdleAuxiliary,
  shouldUseFocusIdleDrawer,
} from "./ChannelPane.helpers.ts";

test("focus idle drawers yield to every higher-priority auxiliary surface", () => {
  const idleDrawer = {
    channelManagementOpen: false,
    hasIdleAuxiliaryPanel: true,
    hasIdlePanelCloseHandler: true,
    hasProfilePanel: false,
    hasThreadSurface: false,
    useSplitAuxiliaryPane: true,
  };

  assert.equal(shouldUseFocusIdleDrawer(idleDrawer), true);
  for (const surface of [
    "channelManagementOpen",
    "hasProfilePanel",
    "hasThreadSurface",
  ]) {
    assert.equal(
      shouldUseFocusIdleDrawer({ ...idleDrawer, [surface]: true }),
      false,
      `idle drawer must yield when ${surface} is open`,
    );
  }
});

test("an explicit thread override keeps the idle panel in its own focus drawer", () => {
  assert.equal(
    shouldUseFocusIdleDrawer({
      channelManagementOpen: false,
      hasIdleAuxiliaryPanel: true,
      hasIdlePanelCloseHandler: true,
      hasProfilePanel: false,
      hasThreadSurface: true,
      overrideThread: true,
      useSplitAuxiliaryPane: false,
    }),
    true,
  );
});

test("idle auxiliary priority does not depend on thread layout mode", () => {
  assert.equal(shouldPrioritizeIdleAuxiliary(true, true), true);
  assert.equal(shouldPrioritizeIdleAuxiliary(true, false), false);
  assert.equal(shouldPrioritizeIdleAuxiliary(false, true), false);
});

test("the open thread's root is marked while the thread owns the side panel", () => {
  const open = {
    channelManagementOpen: false,
    hasThreadSurface: true,
    idleAuxiliaryCoversThread: false,
    openThreadHeadId: "root-b",
    threadHeadId: "root-a",
  };
  // The loaded head wins; before it loads, the routed id marks the row at once.
  assert.equal(selectActiveThreadRootId(open), "root-a");
  assert.equal(
    selectActiveThreadRootId({ ...open, threadHeadId: null }),
    "root-b",
  );
  // Moves with the open thread.
  assert.equal(
    selectActiveThreadRootId({ ...open, threadHeadId: "root-c" }),
    "root-c",
  );
});

test("no root is marked once the thread panel is closed or covered", () => {
  const open = {
    channelManagementOpen: false,
    hasThreadSurface: true,
    idleAuxiliaryCoversThread: false,
    openThreadHeadId: "root-a",
    threadHeadId: "root-a",
  };
  assert.equal(
    selectActiveThreadRootId({
      ...open,
      hasThreadSurface: false,
      openThreadHeadId: null,
      threadHeadId: null,
    }),
    null,
  );
  assert.equal(
    selectActiveThreadRootId({ ...open, channelManagementOpen: true }),
    null,
  );
  assert.equal(
    selectActiveThreadRootId({ ...open, idleAuxiliaryCoversThread: true }),
    null,
  );
});
