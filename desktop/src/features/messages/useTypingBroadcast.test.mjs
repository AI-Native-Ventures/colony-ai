import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

import { JSDOM } from "jsdom";

globalThis.__typingIdentityQuery = { data: undefined };
globalThis.__typingIndicatorSends = [];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/shared/api/hooks") {
      return { shortCircuit: true, url: "buzz-typing-hook:identity" };
    }
    if (specifier === "@/shared/api/relayClient") {
      return { shortCircuit: true, url: "buzz-typing-hook:relay" };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "buzz-typing-hook:identity") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
export function useIdentityQuery() {
  return globalThis.__typingIdentityQuery;
}
`,
      };
    }
    if (url === "buzz-typing-hook:relay") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
export const relayClient = {
  sendTypingIndicator(...args) {
    globalThis.__typingIndicatorSends.push(args);
    return Promise.resolve();
  },
};
`,
      };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  window: dom.window,
});

test("typing broadcast uses only the signed-in identity's saved device preference", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useTypingBroadcast } = await import("./useTypingBroadcast.ts");
  const sent = globalThis.__typingIndicatorSends;
  sent.length = 0;
  window.localStorage.clear();
  globalThis.__typingIdentityQuery = { data: { pubkey: "aabb" } };

  const hook = renderHook(() =>
    useTypingBroadcast("channel-a", "parent-a", "root-a"),
  );

  await act(async () => {
    hook.result.current();
  });
  assert.deepEqual(sent, []);

  window.localStorage.setItem(
    "colony.device-privacy.v1:aabb",
    JSON.stringify({ showMessageText: false, shareTypingActivity: true }),
  );
  globalThis.__typingIdentityQuery = { data: { pubkey: "ccdd" } };
  hook.rerender();
  await act(async () => {
    hook.result.current();
  });
  assert.deepEqual(sent, []);

  globalThis.__typingIdentityQuery = { data: { pubkey: "aabb" } };
  hook.rerender();
  await act(async () => {
    hook.result.current();
    await Promise.resolve();
  });
  assert.deepEqual(sent, [["channel-a", "parent-a", "root-a"]]);

  window.localStorage.setItem(
    "colony.device-privacy.v1:aabb",
    JSON.stringify({ showMessageText: false, shareTypingActivity: false }),
  );
  hook.rerender();
  await act(async () => {
    hook.result.current();
  });
  assert.deepEqual(sent, [["channel-a", "parent-a", "root-a"]]);

  hook.unmount();
  cleanup();
});
