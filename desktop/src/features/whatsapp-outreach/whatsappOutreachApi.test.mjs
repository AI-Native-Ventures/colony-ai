import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhatsAppNip98Header,
  makeWhatsAppCommand,
  postWhatsAppJson,
  publishWhatsAppCommand,
  whatsappCommandKinds,
} from "./whatsappOutreachApi.ts";
import { relayClient } from "@/shared/api/relayClient";

test("NIP-98 binds the exact POST URL and JSON body digest", async () => {
  let signed = null;
  const header = await buildWhatsAppNip98Header(
    "https://relay.example/api/whatsapp/query",
    '{"what":"status"}',
    {
      nonce: () => "fixed-nonce",
      signer: async (event) => {
        signed = event;
        return {
          id: "id",
          pubkey: "pubkey",
          kind: 27235,
          content: "",
          tags: event.tags,
          created_at: 1,
          sig: "sig",
        };
      },
    },
  );
  assert.equal(header.startsWith("Nostr "), true);
  assert.deepEqual(signed.tags, [
    ["u", "https://relay.example/api/whatsapp/query"],
    ["method", "POST"],
    [
      "payload",
      "5cda70126f924ed4159a29357b782816470143d633760eae56efc93b94c8bebf",
    ],
    ["nonce", "fixed-nonce"],
  ]);
});

test("authenticated POST uses the same exact URL and body for its signature", async () => {
  let signed = null;
  let request = null;
  const responseBody = { connected: false };
  const result = await postWhatsAppJson(
    "wss://relay.example/prefix",
    "/api/whatsapp/query",
    { what: "status" },
    {
      nonce: () => "one-use-nonce",
      signer: async (event) => {
        signed = event;
        return {
          id: "id",
          pubkey: "pubkey",
          kind: 27235,
          content: "",
          tags: event.tags,
          created_at: 1,
          sig: "sig",
        };
      },
      fetcher: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify(responseBody), { status: 200 });
      },
    },
  );
  const body = JSON.stringify({ what: "status" });
  assert.equal(request.url, "https://relay.example/prefix/api/whatsapp/query");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, body);
  const authEvent = JSON.parse(
    atob(request.init.headers.Authorization.slice("Nostr ".length)),
  );
  assert.equal(authEvent.kind, 27235);
  assert.equal(authEvent.tags[3][1], "one-use-nonce");
  assert.equal(signed.tags[0][1], request.url);
  assert.equal(
    signed.tags[2][1],
    "5cda70126f924ed4159a29357b782816470143d633760eae56efc93b94c8bebf",
  );
  assert.deepEqual(result, responseBody);
});

test("HTTP failures surface relay copy and malformed success bodies fail closed", async () => {
  const common = {
    signer: async (event) => ({
      id: "id",
      pubkey: "pubkey",
      kind: 27235,
      content: "",
      tags: event.tags,
      created_at: 1,
      sig: "sig",
    }),
  };
  await assert.rejects(
    postWhatsAppJson(
      "ws://relay.example",
      "/api/whatsapp/query",
      { what: "status" },
      {
        ...common,
        fetcher: async () =>
          new Response(
            JSON.stringify({ error: "Only an owner can connect." }),
            {
              status: 403,
            },
          ),
      },
    ),
    /Only an owner can connect\./u,
  );
  await assert.rejects(
    postWhatsAppJson(
      "ws://relay.example",
      "/api/whatsapp/query",
      { what: "status" },
      { ...common, fetcher: async () => new Response("null", { status: 200 }) },
    ),
    /unreadable response/u,
  );
});

test("signed command payloads use the contract kind and have no channel tags", async () => {
  const command = makeWhatsAppCommand(whatsappCommandKinds.decision, {
    v: 1,
    draftId: "draft-id",
    decision: "approve",
    text: "Owner-approved text",
  });
  assert.deepEqual(command, {
    kind: 47049,
    content:
      '{"v":1,"draftId":"draft-id","decision":"approve","text":"Owner-approved text"}',
    tags: [],
  });

  let signed = null;
  let published = null;
  await publishWhatsAppCommand(
    whatsappCommandKinds.send,
    { v: 1, requestId: "request-id", to: "+27615340627", text: "Hello" },
    {
      signer: async (event) => {
        signed = event;
        return {
          id: "id",
          pubkey: "pubkey",
          ...event,
          created_at: 1,
          sig: "sig",
        };
      },
      publisher: async (event, timeout, rejected) => {
        published = { event, timeout, rejected };
      },
    },
  );
  assert.equal(signed.kind, 47050);
  assert.deepEqual(signed.tags, []);
  assert.equal(JSON.parse(signed.content).requestId, "request-id");
  assert.equal(published.event.kind, 47050);
  assert.match(published.timeout, /timed out/iu);
  assert.match(published.rejected, /refused/u);
});

test("a command without an injected publisher publishes through the relay client itself", async () => {
  // GUARD: the default publisher must keep relayClient as `this`; the bare method
  // reference crashed every WhatsApp approve, reject and send in 3.0.13 to 3.0.15.
  const original = relayClient.publishEvent;
  let receiver = null;
  let publishedKind = null;
  relayClient.publishEvent = function (event) {
    receiver = this;
    publishedKind = event.kind;
    return Promise.resolve();
  };
  try {
    await publishWhatsAppCommand(
      whatsappCommandKinds.decision,
      { v: 1, batchId: "batch-id", decision: "approve" },
      {

        signer: async (event) => ({
          id: "id",
          pubkey: "pubkey",
          ...event,
          created_at: 1,
          sig: "sig",
        }),
      },
    );
  } finally {
    relayClient.publishEvent = original;
  }
  assert.equal(receiver, relayClient);
  assert.equal(publishedKind, 47049);
});
