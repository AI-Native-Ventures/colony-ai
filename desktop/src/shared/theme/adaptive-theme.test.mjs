import assert from "node:assert/strict";
import test from "node:test";
import {
  createThemeVars,
  luminance,
  sidebarSectionForeground,
} from "./adaptive-theme.ts";
const ratio = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
test("section labels retain an AA compliant muted hint", () => {
  assert.equal(sidebarSectionForeground("#a39aa9", ["#212026"]), "#a39aa9");
});
test("section labels brighten only enough for both sidebar surfaces", () => {
  const backgrounds = ["#76436f", "#6a4a74"];
  const result = sidebarSectionForeground("#a39aa9", backgrounds);
  assert.notEqual(result, "#ffffff");
  for (const background of backgrounds)
    assert.ok(ratio(result, background) >= 4.5);
  const channels = result
    .match(/\w\w/g)
    .map((channel) => parseInt(channel, 16) - 1);
  const dimmer = `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  assert.ok(backgrounds.some((background) => ratio(dimmer, background) < 4.52));
});

test("themes without a comment hint still have muted section labels", () => {
  const { vars } = createThemeVars("#24292e", "#e1e4e8", "#e1e4e8");
  assert.notEqual(
    vars["--sidebar-section-foreground"],
    vars["--sidebar-foreground"],
  );
});
