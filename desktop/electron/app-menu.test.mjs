import assert from "node:assert/strict";
import test from "node:test";
import { appMenuTemplate, installAppMenu } from "./app-menu.mjs";

const roles = (items) => items.map((item) => item.role ?? item.type);

test("macOS menu carries the edit roles that make clipboard shortcuts work", () => {
  const template = appMenuTemplate({ name: "Buzz", platform: "darwin" });
  const edit = template.find((item) => item.label === "Edit");
  assert.deepEqual(roles(edit.submenu), [
    "undo",
    "redo",
    "separator",
    "cut",
    "copy",
    "paste",
    "selectAll",
  ]);
  assert.equal(template[0].label, "Buzz");
  assert.ok(roles(template[0].submenu).includes("quit"));
});

test("no menu item claims Cmd+W, so the app's close shortcut receives it", () => {
  const all = JSON.stringify(
    appMenuTemplate({ name: "Buzz", platform: "darwin" }),
  );
  assert.ok(!all.includes('"close"'));
  assert.ok(!all.includes("CmdOrCtrl+W"));
});

test("only macOS shows the application menu bar", () => {
  const installed = [];
  const Menu = {
    buildFromTemplate: (template) => ({ template }),
    setApplicationMenu: (menu) => installed.push(menu),
  };
  const app = { getName: () => "Buzz" };
  installAppMenu({ Menu, app, platform: "darwin" });
  installAppMenu({ Menu, app, platform: "win32" });
  assert.ok(installed[0]?.template);
  assert.equal(installed[1], null);
});
