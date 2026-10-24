import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: dom.window.Node,
    window: dom.window,
  });
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

after(() => dom.window.close());

const agent = {
  avatarUrl: null,
  displayName: "Agent Ada",
  pubkey: "agent-pubkey",
};
const secondAgent = {
  avatarUrl: null,
  displayName: "Agent Bea",
  pubkey: "second-agent-pubkey",
};
const thirdAgent = {
  avatarUrl: null,
  displayName: "Agent Cia",
  pubkey: "third-agent-pubkey",
};

test("mention control expands with automatically mentioned agents", async () => {
  const React = await import("react");
  const { fireEvent, render } = await import("@testing-library/react");
  const { TooltipProvider } = await import("@/shared/ui/tooltip");
  const { ComposerMentionButton } = await import(
    "./ComposerAddressControls.tsx"
  );
  let opened = 0;
  const removed = [];
  const renderButton = (agents) =>
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ComposerMentionButton, {
        agents,
        disabled: false,
        onCaptureSelection: () => {},
        onOpen: () => {
          opened += 1;
        },
        onRemove: (pubkey) => removed.push(pubkey),
        showAgents: true,
      }),
    );
  const view = render(renderButton([agent]));
  view.rerender(renderButton([agent, secondAgent, thirdAgent]));

  assert.ok(view.getByTestId("composer-address-locks"));
  // Colony 3.0: the mention tool is a toolbar button; addressed agents are
  // chips beside it, each with its own remove button.
  const chip = view.getByTestId("composer-address-chip-agent-pubkey");
  assert.ok(chip);
  const manage = view.getByRole("button", { name: "Manage mentions" });
  assert.equal(manage.className, "c3c-tool");
  assert.equal(manage.getAttribute("data-active"), "true");
  assert.equal(manage.parentElement?.className, "c3c-mention");
  assert.equal(manage.parentElement?.getAttribute("data-active"), "true");
  for (const addedAgent of [secondAgent, thirdAgent]) {
    const addedChip = view.getByTestId(
      `composer-address-chip-${addedAgent.pubkey}`,
    );
    assert.equal(addedChip.style.opacity, "0");
    assert.match(addedChip.style.transform ?? "", /scale\(0.8\)/);
  }
  const remove = view.getByRole("button", {
    name: "Don't automatically mention Agent Ada in this thread",
  });
  assert.equal(
    remove.getAttribute("aria-label")?.includes("conversation"),
    false,
  );
  assert.equal(remove.className, "c3c-chip-remove");
  fireEvent.click(remove);
  assert.deepEqual(removed, ["agent-pubkey"]);
  view.rerender(renderButton([]));
  assert.equal(
    view.getByRole("button", { name: "Mention someone" }).parentElement
      ?.className,
    "c3c-mention",
  );
  fireEvent.click(view.getByRole("button", { name: "Mention someone" }));
  assert.equal(opened, 1);
});
