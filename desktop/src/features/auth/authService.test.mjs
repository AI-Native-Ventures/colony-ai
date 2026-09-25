import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { AuthApiError, createAuthService } from "./authService.ts";

const ACCOUNT = {
  id: "account-1",
  email: "founder@example.com",
  pubkey: "a".repeat(64),
  has_password: true,
  google_linked: false,
};
const SESSION_NSEC = "nsec1generated-test-session";
const SERVER_SESSION = { account: ACCOUNT, nsec: SESSION_NSEC };

async function withFakeServer(handler, run) {
  const server = createServer((request, response) => {
    let bodyText = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      bodyText += chunk;
    });
    request.on("end", async () => {
      let body;
      try {
        body = bodyText ? JSON.parse(bodyText) : undefined;
      } catch {
        body = undefined;
      }
      try {
        const result = await handler({
          method: request.method,
          path: request.url,
          headers: request.headers,
          bodyText,
          body,
        });
        response.statusCode = result.status;
        if (result.body !== undefined) {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(result.body));
        } else {
          response.end();
        }
      } catch {
        response.statusCode = 500;
        response.end();
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function createService(baseUrl, options = {}) {
  let activePubkey = options.initialPubkey ?? "b".repeat(64);
  const imports = [];
  const signedEvents = [];
  const deps = {
    getRelayHttpUrl: async () => baseUrl,
    signRelayEvent: async (input) => {
      const event = {
        id: "f".repeat(64),
        pubkey: options.signingPubkey ?? activePubkey,
        kind: input.kind,
        content: input.content,
        created_at: 1_800_000_000,
        tags: input.tags,
        sig: "e".repeat(128),
      };
      signedEvents.push(event);
      return event;
    },
    getIdentity: async () => ({ pubkey: activePubkey }),
    getNsec: async () => options.nsec ?? "nsec1existing-test-identity",
    importIdentity: async (nsec) => {
      imports.push(nsec);
      activePubkey = (options.sessionAccount ?? ACCOUNT).pubkey;
      return { pubkey: activePubkey };
    },
    googleSignIn: options.googleSignIn ?? (async () => "test.google.id.token"),
    fetcher: options.fetcher,
  };
  return {
    service: createAuthService(deps),
    imports,
    signedEvents,
    setPubkey(pubkey) {
      activePubkey = pubkey;
    },
    get activePubkey() {
      return activePubkey;
    },
  };
}

function successFor(method, path) {
  if (method === "POST" && path === "/api/accounts/signup") {
    return { status: 202, body: { status: "verification_sent" } };
  }
  if (method === "POST" && path === "/api/accounts/verify") {
    return { status: 200, body: SERVER_SESSION };
  }
  if (method === "POST" && path === "/api/accounts/resend-code") {
    return { status: 202, body: { status: "verification_sent" } };
  }
  if (method === "POST" && path === "/api/accounts/signin") {
    return { status: 200, body: SERVER_SESSION };
  }
  if (method === "POST" && path === "/api/accounts/google") {
    return { status: 200, body: SERVER_SESSION };
  }
  if (method === "POST" && path === "/api/accounts/reset/request") {
    return { status: 202, body: { status: "verification_sent" } };
  }
  if (method === "POST" && path === "/api/accounts/reset/confirm") {
    return { status: 200, body: SERVER_SESSION };
  }
  if (method === "POST" && path === "/api/accounts/claim") {
    return { status: 202, body: { status: "verification_sent" } };
  }
  if (method === "POST" && path === "/api/accounts/password") {
    return { status: 204 };
  }
  if (method === "GET" && path === "/api/accounts/me") {
    return { status: 200, body: { account: ACCOUNT } };
  }
  if (method === "DELETE" && path === "/api/accounts/me") {
    return { status: 204 };
  }
  return { status: 404, body: { error: "not_found" } };
}

function decodeNip98(request) {
  const authorization = request.headers.authorization;
  assert.equal(typeof authorization, "string");
  assert.ok(authorization.startsWith("Nostr "));
  return JSON.parse(
    Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
      "utf8",
    ),
  );
}

function tagValue(event, key) {
  return event.tags.find((tag) => tag[0] === key)?.[1];
}

test("service covers every account endpoint and signs protected routes", async () => {
  const requests = [];
  await withFakeServer(
    async (request) => {
      requests.push(request);
      const path = new URL(request.path, "http://localhost").pathname;
      return successFor(request.method, path);
    },
    async (baseUrl) => {
      const auth = createService(baseUrl);
      assert.deepEqual(
        await auth.service.signUp(" founder@example.com ", "correct horse"),
        {
          status: "verification_sent",
        },
      );
      assert.deepEqual(
        await auth.service.verifyEmail("founder@example.com", "012345"),
        {
          id: ACCOUNT.id,
          email: ACCOUNT.email,
          pubkey: ACCOUNT.pubkey,
          hasPassword: true,
          googleLinked: false,
        },
      );
      assert.deepEqual(
        await auth.service.resendCode("founder@example.com", "verify"),
        { status: "verification_sent" },
      );
      assert.deepEqual(
        await auth.service.resendCode("founder@example.com", "reset"),
        { status: "verification_sent" },
      );
      await auth.service.signIn("founder@example.com", "password");
      await auth.service.signInWithGoogle();
      await auth.service.requestReset("founder@example.com");
      await auth.service.confirmReset(
        "founder@example.com",
        "654321",
        "new password",
      );
      await auth.service.claimAccount("founder@example.com", "claim password");
      await auth.service.changePassword("changed password");
      assert.deepEqual(await auth.service.getAccount(), {
        id: ACCOUNT.id,
        email: ACCOUNT.email,
        pubkey: ACCOUNT.pubkey,
        hasPassword: true,
        googleLinked: false,
      });
      await auth.service.getAccount();
      await auth.service.deleteAccount();

      const endpointKeys = new Set(
        requests.map(
          (request) =>
            `${request.method} ${new URL(request.path, baseUrl).pathname}`,
        ),
      );
      assert.deepEqual([...endpointKeys].sort(), [
        "DELETE /api/accounts/me",
        "GET /api/accounts/me",
        "POST /api/accounts/claim",
        "POST /api/accounts/google",
        "POST /api/accounts/password",
        "POST /api/accounts/resend-code",
        "POST /api/accounts/reset/confirm",
        "POST /api/accounts/reset/request",
        "POST /api/accounts/signin",
        "POST /api/accounts/signup",
        "POST /api/accounts/verify",
      ]);
      assert.equal(requests.length, 12);

      const signup = requests.find(
        (request) => request.path === "/api/accounts/signup",
      );
      assert.deepEqual(signup.body, {
        email: "founder@example.com",
        password: "correct horse",
      });
      const verify = requests.find(
        (request) => request.path === "/api/accounts/verify",
      );
      assert.deepEqual(verify.body, {
        email: "founder@example.com",
        code: "012345",
      });
      const google = requests.find(
        (request) => request.path === "/api/accounts/google",
      );
      assert.deepEqual(google.body, { id_token: "test.google.id.token" });
      const reset = requests.find(
        (request) => request.path === "/api/accounts/reset/confirm",
      );
      assert.deepEqual(reset.body, {
        email: "founder@example.com",
        code: "654321",
        new_password: "new password",
      });
      const claim = requests.find(
        (request) => request.path === "/api/accounts/claim",
      );
      assert.deepEqual(claim.body, {
        email: "founder@example.com",
        password: "claim password",
        nsec: "nsec1existing-test-identity",
      });
      const password = requests.find(
        (request) => request.path === "/api/accounts/password",
      );
      assert.deepEqual(password.body, { new_password: "changed password" });
      const resendPurposes = requests
        .filter((request) => request.path === "/api/accounts/resend-code")
        .map((request) => request.body.purpose)
        .sort();
      assert.deepEqual(resendPurposes, ["reset", "verify"]);

      for (const request of requests.filter((entry) =>
        [
          "/api/accounts/claim",
          "/api/accounts/password",
          "/api/accounts/me",
        ].includes(new URL(entry.path, baseUrl).pathname),
      )) {
        const event = decodeNip98(request);
        assert.equal(event.kind, 27235);
        assert.equal(tagValue(event, "u"), baseUrl + request.path);
        assert.equal(tagValue(event, "method"), request.method);
        assert.equal(event.pubkey, ACCOUNT.pubkey);
        assert.ok(tagValue(event, "nonce"));
        if (request.bodyText) {
          assert.equal(
            tagValue(event, "payload"),
            createHash("sha256").update(request.bodyText).digest("hex"),
          );
        } else {
          assert.equal(tagValue(event, "payload"), undefined);
        }
      }
    },
  );
});

test("session nsec reaches import_identity, is blanked, and is absent from the result", async () => {
  let parsedSession;
  const originalParse = JSON.parse;
  JSON.parse = function captureSession(...args) {
    const value = originalParse.apply(JSON, args);
    if (value?.nsec === SESSION_NSEC) parsedSession = value;
    return value;
  };
  try {
    await withFakeServer(
      async (request) => {
        const path = new URL(request.path, "http://localhost").pathname;
        return successFor(request.method, path);
      },
      async (baseUrl) => {
        const auth = createService(baseUrl);
        const result = await auth.service.verifyEmail(
          "founder@example.com",
          "123456",
        );
        assert.deepEqual(auth.imports, [SESSION_NSEC]);
        assert.equal(parsedSession.nsec, "");
        assert.equal(Object.hasOwn(result, "nsec"), false);
        assert.equal(JSON.stringify(result).includes(SESSION_NSEC), false);
        assert.equal(
          JSON.stringify(auth.service).includes(SESSION_NSEC),
          false,
        );
      },
    );
  } finally {
    JSON.parse = originalParse;
  }
});

test("contract errors map to typed failures and preserve the retry hint without replay", async () => {
  const cases = [
    [400, "invalid_request", "invalid_request"],
    [401, "invalid_credentials", "invalid_credentials"],
    [403, "email_unverified", "email_unverified"],
    [409, "email_taken", "email_taken"],
    [409, "identity_taken", "identity_taken"],
    [410, "code_expired", "code_expired"],
    [422, "weak_password", "weak_password"],
    [429, "rate_limited", "rate_limited"],
  ];
  let override;
  const requests = [];
  await withFakeServer(
    async (request) => {
      requests.push(request);
      return override;
    },
    async (baseUrl) => {
      const auth = createService(baseUrl);
      for (const [status, error, code] of cases) {
        override = {
          status,
          body: {
            error,
            ...(status === 429
              ? { retry_after_secs: 37, remaining_attempts: 2 }
              : {}),
          },
        };
        await assert.rejects(
          auth.service.signUp("founder@example.com", "password"),
          (failure) => {
            assert.ok(failure instanceof AuthApiError);
            assert.equal(failure.code, code);
            assert.equal(failure.status, status);
            if (status === 429) {
              assert.equal(failure.retryAfterSecs, 37);
              assert.equal(failure.remainingAttempts, 2);
            }
            return true;
          },
        );
      }
      assert.equal(requests.length, cases.length);
    },
  );
});

test("invalid verification responses preserve only the server attempt count", async () => {
  await withFakeServer(
    async () => ({
      status: 401,
      body: { error: "invalid_credentials", remaining_attempts: 2 },
    }),
    async (baseUrl) => {
      const auth = createService(baseUrl);
      await assert.rejects(
        auth.service.verifyEmail("founder@example.com", "000000"),
        (failure) => {
          assert.ok(failure instanceof AuthApiError);
          assert.equal(failure.code, "invalid_credentials");
          assert.equal(failure.remainingAttempts, 2);
          assert.equal("remaining_attempts" in failure, false);
          return true;
        },
      );
    },
  );
});

test("unclaimed account result is cached per identity while relay failures are retried", async () => {
  const requests = [];
  let unavailable = false;
  await withFakeServer(
    async (request) => {
      requests.push(request);
      if (unavailable)
        return { status: 503, body: { error: "database detail" } };
      if (request.method === "GET") {
        if (requests.filter((item) => item.method === "GET").length === 1) {
          return { status: 404, body: { error: "account_not_found" } };
        }
        return {
          status: 200,
          body: { account: { ...ACCOUNT, pubkey: "c".repeat(64) } },
        };
      }
      return { status: 204 };
    },
    async (baseUrl) => {
      const auth = createService(baseUrl, { initialPubkey: "b".repeat(64) });
      assert.equal(await auth.service.getAccount(), null);
      assert.equal(await auth.service.getAccount(), null);
      assert.equal(requests.filter((item) => item.method === "GET").length, 1);

      auth.setPubkey("c".repeat(64));
      const account = await auth.service.getAccount();
      assert.equal(account.pubkey, "c".repeat(64));
      assert.equal(requests.filter((item) => item.method === "GET").length, 2);

      auth.setPubkey("d".repeat(64));
      unavailable = true;
      await assert.rejects(auth.service.getAccount(), (failure) => {
        assert.ok(failure instanceof AuthApiError);
        assert.equal(failure.code, "server_error");
        assert.equal(failure.message.includes("database detail"), false);
        return true;
      });
      await assert.rejects(auth.service.getAccount(), (failure) => {
        assert.equal(failure.code, "server_error");
        return true;
      });
      assert.equal(requests.filter((item) => item.method === "GET").length, 4);
    },
  );
});

test("an in-flight account lookup cannot restore cache after account deletion", async () => {
  let finishFirstRead;
  let signalFirstRead;
  const firstReadStarted = new Promise((resolve) => {
    signalFirstRead = resolve;
  });
  const firstRead = new Promise((resolve) => {
    finishFirstRead = resolve;
  });
  let accountReads = 0;

  await withFakeServer(
    async (request) => {
      if (request.method === "DELETE") return { status: 204 };
      accountReads += 1;
      if (accountReads === 1) {
        signalFirstRead();
        return firstRead;
      }
      return { status: 404, body: { error: "account_not_found" } };
    },
    async (baseUrl) => {
      const auth = createService(baseUrl);
      const staleLookup = auth.service.getAccount();
      await firstReadStarted;
      await auth.service.deleteAccount();
      finishFirstRead({
        status: 200,
        body: { account: { ...ACCOUNT, pubkey: "b".repeat(64) } },
      });

      await assert.rejects(staleLookup, (failure) => {
        assert.ok(failure instanceof AuthApiError);
        assert.equal(failure.code, "account_state_changed");
        return true;
      });
      assert.equal(await auth.service.getAccount(), null);
      assert.equal(await auth.service.getAccount(), null);
      assert.equal(accountReads, 2);
    },
  );
});

test("remote plaintext relay URLs are rejected before credentials are sent", async () => {
  let fetchCount = 0;
  const auth = createService("http://relay.example", {
    fetcher: async () => {
      fetchCount += 1;
      return new Response(null, { status: 204 });
    },
  });
  await assert.rejects(
    auth.service.signIn("founder@example.com", "password"),
    (failure) => {
      assert.ok(failure instanceof AuthApiError);
      assert.equal(failure.code, "insecure_transport");
      return true;
    },
  );
  assert.equal(fetchCount, 0);
});

test("account request and response bodies are capped at 64 KiB", async () => {
  let requestCount = 0;
  await withFakeServer(
    async () => {
      requestCount += 1;
      return {
        status: 202,
        body: {
          status: "verification_sent",
          extra: "x".repeat(70 * 1024),
        },
      };
    },
    async (baseUrl) => {
      const auth = createService(baseUrl);
      await assert.rejects(
        auth.service.signUp("founder@example.com", "p".repeat(70 * 1024)),
        (failure) => {
          assert.equal(failure.code, "invalid_request");
          return true;
        },
      );
      assert.equal(requestCount, 0);

      await assert.rejects(
        auth.service.signUp("founder@example.com", "valid sized password"),
        (failure) => {
          assert.equal(failure.code, "invalid_response");
          return true;
        },
      );
      assert.equal(requestCount, 1);
    },
  );
});

test("signed routes stop if the active identity changes before signing", async () => {
  let fetchCount = 0;
  const auth = createService("https://relay.example", {
    initialPubkey: "b".repeat(64),
    signingPubkey: "a".repeat(64),
    fetcher: async () => {
      fetchCount += 1;
      return new Response(null, { status: 204 });
    },
  });
  auth.setPubkey("b".repeat(64));
  await assert.rejects(
    auth.service.changePassword("new password"),
    (failure) => {
      assert.ok(failure instanceof AuthApiError);
      assert.equal(failure.code, "identity_changed");
      return true;
    },
  );
  assert.equal(fetchCount, 0);
});
