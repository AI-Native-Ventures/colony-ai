import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, createAuthApi } from "./authApi.ts";
const account = {
  id: "account",
  email: "test@example.test",
  pubkey: "a".repeat(64),
  has_password: true,
  google_linked: false,
};
const read = (response) =>
  createAuthApi({
    baseUrl: "https://relay.example.test",
    signRelayEvent: async (input) => ({ ...input, pubkey: account.pubkey }),
    fetcher: async () => response,
  }).getAccount(account.pubkey);

test("account lookup accepts flat, superset and wrapped responses, preferring flat fields", async () => {
  for (const body of [
    account,
    { account },
    { ...account, account: { ...account, email: "old@example.test" } },
  ]) {
    const result = await read(Response.json(body));
    assert.equal(result.email, account.email);
    assert.equal(result.pubkey, account.pubkey);
  }
});
test("malformed successful JSON and invalid account shapes are contract failures", async () => {
  for (const response of [
    new Response("{", { status: 200 }),
    Response.json({ account: {} }),
  ])
    await assert.rejects(
      read(response),
      (error) =>
        error instanceof AuthApiError && error.code === "invalid_response",
    );
});
test("401, 403 and 429 stay typed when a relay supplies no recognized error code", async () => {
  for (const [status, code] of [
    [401, "authentication_required"],
    [403, "access_denied"],
    [429, "rate_limited"],
  ])
    await assert.rejects(
      read(Response.json({}, { status })),
      (error) =>
        error instanceof AuthApiError &&
        error.status === status &&
        error.code === code,
    );
});
