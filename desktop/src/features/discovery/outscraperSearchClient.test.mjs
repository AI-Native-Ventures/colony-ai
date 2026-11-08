import assert from "node:assert/strict";
import test, { after } from "node:test";

import { DiscoverySearchError } from "./discoverySearch.ts";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => undefined } };

const { searchPlaces } = await import("./outscraperSearchClient.ts");

const request = {
  query: "Bars and Drinking Establishments",
  location: "Johannesburg, South Africa",
  country: "ZA",
  limit: 20,
  skip: 0,
};

function setInvoke(invoke) {
  globalThis.window.__TAURI_INTERNALS__.invoke = invoke;
}

after(() => {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
});

test("the real NIP-98 signing seam reports signing and never starts fetch", async () => {
  let fetchCalls = 0;
  setInvoke(async (command) => {
    assert.equal(command, "sign_event");
    throw "identity is in recovery mode; event signing is disabled";
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not run after a signing failure");
  };

  await assert.rejects(
    searchPlaces({ relayUrl: "ws://relay.example", request }),
    (error) => {
      assert.ok(error instanceof DiscoverySearchError);
      assert.equal(error.actionFailure?.failureClass, "signing");
      assert.equal(error.actionFailure?.code, "identity_recovery");
      assert.match(error.message, /could not sign/i);
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("the real search seam carries relay status and code to the campaign dialog", async () => {
  let authorization = "";
  setInvoke(async (command) => {
    assert.equal(command, "sign_event");
    return JSON.stringify({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      kind: 27235,
      content: "",
      created_at: 1,
      tags: [],
      sig: "c".repeat(128),
    });
  });
  globalThis.fetch = async (_url, init) => {
    authorization = init?.headers?.Authorization ?? "";
    return new Response(
      JSON.stringify({
        error:
          "Provider credits are exhausted. Ask the community owner to refill them.",
        code: "discovery_provider_credits",
      }),
      { status: 402 },
    );
  };

  await assert.rejects(
    searchPlaces({ relayUrl: "ws://relay.example", request }),
    (error) => {
      assert.ok(error instanceof DiscoverySearchError);
      assert.equal(error.actionFailure?.failureClass, "server");
      assert.equal(error.actionFailure?.status, 402);
      assert.equal(error.actionFailure?.code, "discovery_provider_credits");
      return true;
    },
  );
  assert.match(authorization, /^Nostr /);
});

test("the real search seam maps a monthly limit and its reset date for the dialog", async () => {
  setInvoke(async (command) => {
    assert.equal(command, "sign_event");
    return JSON.stringify({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      kind: 27235,
      content: "",
      created_at: 1,
      tags: [],
      sig: "c".repeat(128),
    });
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "monthly_limit",
        resets_at: "2026-12-01T00:00:00Z",
      }),
      { status: 429 },
    );

  await assert.rejects(
    searchPlaces({ relayUrl: "ws://relay.example", request }),
    (error) => {
      assert.ok(error instanceof DiscoverySearchError);
      assert.equal(error.code, "monthly_limit");
      assert.equal(error.status, 429);
      assert.equal(error.resetsAt, "2026-12-01");
      assert.equal(
        error.actionFailure?.message,
        "You have used this month’s prospect searches. They reset on 2026-12-01.",
      );
      return true;
    },
  );
});

test("the real search seam classifies a relay connection failure", async () => {
  setInvoke(async (command) => {
    assert.equal(command, "sign_event");
    return JSON.stringify({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      kind: 27235,
      content: "",
      created_at: 1,
      tags: [],
      sig: "c".repeat(128),
    });
  });
  globalThis.fetch = async () => {
    throw new Error("socket reset by peer");
  };

  await assert.rejects(
    searchPlaces({ relayUrl: "ws://relay.example", request }),
    (error) => {
      assert.ok(error instanceof DiscoverySearchError);
      assert.equal(error.actionFailure?.failureClass, "connection");
      assert.equal(error.actionFailure?.code, "network");
      assert.match(error.message, /could not reach the relay/i);
      return true;
    },
  );
});
