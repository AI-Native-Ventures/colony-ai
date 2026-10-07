import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
let renderHook, cleanup, createElement, QueryClient, QueryClientProvider;
let gate, useMembershipDenialWatcher;

const DENIED = new Error(
  "relay returned 403 Forbidden: You must be a relay member to access this relay",
);

before(async () => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  ({ renderHook, cleanup } = await import("@testing-library/react"));
  ({ createElement } = await import("react"));
  ({ QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  ));
  gate = await import("./membershipDenialGate.ts");
  ({ useMembershipDenialWatcher } = await import(
    "./useMembershipDenialWatcher.ts"
  ));
});
afterEach(() => {
  cleanup();
  gate.resetMembershipDenialGate();
});
after(() => dom.window.close());

function mount(communityId) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => useMembershipDenialWatcher(communityId), {
    wrapper,
  });
  return { queryClient, ...hook };
}

const failing = (queryClient, key, error) =>
  queryClient
    .fetchQuery({
      queryKey: key,
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => undefined);

test("a membership refusal on any workspace query raises the gate", async () => {
  const { queryClient } = mount("a");
  await failing(queryClient, ["feed"], DENIED);
  assert.equal(gate.getMembershipDenial()?.communityId, "a");
});

test("other query failures do not raise the gate", async () => {
  const { queryClient } = mount("a");
  await failing(queryClient, ["feed"], new Error("boom"));
  assert.equal(gate.getMembershipDenial(), null);
});

test("a workspace from before a community switch cannot raise the gate", async () => {
  const { queryClient } = mount("a");
  // The switch resets community state, then the old tree's request fails late.
  gate.resetMembershipDenialGate();
  await failing(queryClient, ["feed"], DENIED);
  assert.equal(gate.getMembershipDenial(), null);
});

test("an unmounted workspace stops reporting", async () => {
  const { queryClient, unmount } = mount("a");
  unmount();
  await failing(queryClient, ["feed"], DENIED);
  assert.equal(gate.getMembershipDenial(), null);
});
