import assert from "node:assert/strict";
import test from "node:test";

import { fetchMoneyRailsSnapshot } from "./moneyRailsApi.ts";

function installTauriSigner() {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
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
      },
    },
  };
  return () => {
    globalThis.window = originalWindow;
  };
}

test("an older relay without money routes leaves the new desktop usable", async () => {
  const restoreWindow = installTauriSigner();
  const originalFetch = globalThis.fetch;
  const requestPaths = [];
  globalThis.fetch = async (url) => {
    requestPaths.push(String(url));
    return new Response(JSON.stringify({ code: "not_found" }), {
      status: 404,
    });
  };

  try {
    const snapshot = await fetchMoneyRailsSnapshot("wss://relay.example");
    assert.ok(requestPaths.length >= 1);
    assert.ok(
      requestPaths.every(
        (path) => path === "https://relay.example/api/money-rails/query",
      ),
    );
    assert.deepEqual(snapshot, {
      paymentLinks: [],
      connections: [],
      availability: "not_ready",
      errorMessage: "Money connections are not enabled on this relay yet.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});
