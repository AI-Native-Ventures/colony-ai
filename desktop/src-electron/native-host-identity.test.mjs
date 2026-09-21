import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  IDENTITY_PROTOCOL_VERSION,
  IdentityFrameDecoder,
  PRODUCTION_CAPABILITIES,
  PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  PRODUCTION_REGISTRY_DIGEST,
  encodeIdentityFrame,
} from "./identity-protocol.mjs";
import { NativeHost } from "./native-host.mjs";

const SESSION_ID = "identity-native-test";
const BUILD_ID = "identity-native-test-build";
const LAUNCH = Object.freeze({
  profileId: "0000000000000001",
  flavor: "normal",
  platform: "macos",
  userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
  identityMode: "explicit",
  sharedIdentity: false,
  resetProvenance: "not_attempted_fresh",
  identityManifestDigest: PRODUCTION_IDENTITY_MANIFEST_DIGEST,
});

function frame(type, generationId, fields = {}) {
  return {
    type,
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    profileId: LAUNCH.profileId,
    sessionId: SESSION_ID,
    generationId,
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
    ...fields,
  };
}

function response(request, payload, outcome = "ok", fields = {}) {
  const { code = outcome } = fields;
  return frame("RESPONSE", request.generationId, {
    requestId: request.requestId,
    outcome,
    ...(outcome === "ok" ? { payload } : { error: { code } }),
  });
}

function createFakeIdentitySpawn({ delayResponse = false } = {}) {
  let child;
  let exited = false;
  let stdinEnded = false;
  const delayedRequests = [];
  const spawnCalls = [];

  const emitExit = (code = 0) => {
    if (exited) return;
    exited = true;
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", code, null);
    child.emit("close", code, null);
  };

  const send = (value, responseContext = null) => {
    queueMicrotask(() => {
      if (!exited) {
        child.stdout.write(
          encodeIdentityFrame(value, {
            direction: "host",
            responseCapability: responseContext?.capability,
            responseMethod: responseContext?.method,
          }),
        );
      }
    });
  };

  const spawn = (executablePath, args, options) => {
    spawnCalls.push({ executablePath, args, options });
    child = new EventEmitter();
    child.pid = 9022;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const decoder = new IdentityFrameDecoder({ direction: "main" });

    const handleInput = (input) => {
      if (input.type === "HELLO") {
        send(
          frame("READY", 1, {
            payload: { capabilities: [...PRODUCTION_CAPABILITIES] },
          }),
        );
        send(
          frame("EVENT", 1, {
            event: "host_lifecycle",
            payload: { state: "ready" },
            sequence: 1,
          }),
        );
      } else if (input.type === "REQUEST") {
        if (delayResponse && input.generationId === 1) {
          delayedRequests.push(input);
          return;
        }
        const payload =
          input.method === "is_shared_identity"
            ? { value: false }
            : input.method === "get_identity"
              ? {
                  display_name: "identity-native-test",
                  locked: false,
                  lost: false,
                  pubkey: "0123456789abcdef",
                  reset_failed: false,
                  storage: "system-keyring",
                }
              : { relayUrl: "ws://localhost:3000" };
        send(response(input, payload), input);
      } else if (input.type === "CANCEL") {
        send(response(input, undefined, "cancelled"), input);
      } else if (input.type === "REHELLO") {
        for (const delayed of delayedRequests.splice(0)) {
          send(
            response(
              delayed,
              undefined,
              "outcome_unknown",
              { code: "renderer_rebound" },
            ),
            delayed,
          );
        }
        send(frame("REBOUND", input.generationId));
        send(
          frame("EVENT", input.generationId, {
            event: "host_lifecycle",
            payload: { state: "rebound" },
            sequence: input.generationId,
          }),
        );
      }
    };

    child.stdin.on("data", (chunk) => {
      for (const input of decoder.push(chunk)) handleInput(input);
    });
    child.stdin.on("finish", () => {
      stdinEnded = true;
      emitExit(0);
    });
    child.kill = () => emitExit(0);
    return child;
  };

  return {
    spawn,
    spawnCalls,
    get child() {
      return child;
    },
    get stdinEnded() {
      return stdinEnded;
    },
    emitExit,
  };
}

function hostWith(fake, options = {}) {
  return new NativeHost({
    executablePath: "/test/colony-native-host",
    sessionId: SESSION_ID,
    buildId: BUILD_ID,
    identityLaunch: LAUNCH,
    spawnImpl: fake.spawn,
    ...options,
  });
}

test("NativeHost opts into production identity-v2 and serves only named calls", async () => {
  const fake = createFakeIdentitySpawn();
  const host = hostWith(fake);
  const binding = await host.start();
  assert.equal(fake.spawnCalls[0].args[0], "--identity-v2");
  assert.equal(binding.profileId, LAUNCH.profileId);
  assert.equal(host.getBindingState().registryDigest, PRODUCTION_REGISTRY_DIGEST);

  const shared = await host.request({
    capability: "identity-mode",
    method: "is_shared_identity",
    payload: {},
  });
  assert.deepEqual(shared.payload, { value: false });
  const metadata = await host.request({
    capability: "identity-read",
    method: "get_identity",
    payload: {},
  });
  assert.equal(metadata.payload.storage, "system-keyring");
  const health = await host.requestHealthSafe();
  assert.equal(health.payload.relayUrl, "ws://localhost:3000");
  await host.dispose();
  assert.equal(fake.stdinEnded, true);
});

test("identity-v2 forwards only the explicit inherited environment to its child", async () => {
  const fake = createFakeIdentitySpawn();
  const host = hostWith(fake, {
    inheritedEnv: {
      HOME: "/proof/home",
    },
  });
  await host.start();
  assert.equal(fake.spawnCalls[0].options.env.HOME, "/proof/home");
  await host.dispose();
});

test("identity-v2 rebind fences delayed old responses and accepts post-ACK calls", async () => {
  const fake = createFakeIdentitySpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const oldRequest = host.request({
    capability: "identity-mode",
    method: "is_shared_identity",
    payload: {},
  });
  const rebound = await host.rebind(2);
  await assert.rejects(oldRequest, (error) => error.code === "renderer_rebound");
  assert.equal(rebound.generationId, 2);
  const fresh = await host.request({
    capability: "identity-mode",
    method: "is_shared_identity",
    payload: {},
  });
  assert.equal(fresh.generationId, 2);
  await host.dispose();
});

test("identity-v2 rejects unknown named calls before child dispatch", async () => {
  const fake = createFakeIdentitySpawn();
  const host = hostWith(fake);
  await host.start();
  await assert.rejects(
    host.request({
      capability: "identity-read",
      method: "is_shared_identity",
      payload: {},
    }),
    (error) => error.code === "unknown_method",
  );
  await host.dispose();
});

test("identity-v2 rejects non-empty payloads before child dispatch", async () => {
  const fake = createFakeIdentitySpawn();
  const host = hostWith(fake);
  await host.start();
  await assert.rejects(
    host.request({
      capability: "identity-read",
      method: "get_identity",
      payload: { secret: "must-not-cross" },
    }),
    (error) => error.code === "invalid_payload",
  );
  await host.dispose();
});
