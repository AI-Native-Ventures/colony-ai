import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "../electron/chatgpt/test-support.mjs";

test("fake enforces PKCE, rotating refresh-token reuse and request policy", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const a = (await f.read()).accounts[0];
  const token = async (form) =>
    fetch(`${f.fake.origin}/api/accounts/oauth/token`, {
      method: "POST",
      body: new URLSearchParams(form),
    });
  const refresh = {
    grant_type: "refresh_token",
    client_id: a.client_id,
    refresh_token: a.refresh_token,
    resource: `${f.fake.origin}/v1`,
  };
  assert.equal((await token({ ...refresh, scope: "openid" })).status, 400);
  assert.equal(
    (await token({ ...refresh, client_id: "dynamic_agent_client" })).status,
    400,
  );
  assert.equal(
    (await token({ ...refresh, resource: "https://evil.example" })).status,
    400,
  );
  assert.equal((await token(refresh)).status, 200);
  const reused = await token(refresh);
  assert.equal((await reused.json()).error.code, "refresh_token_reused");
  assert.equal(
    (
      await fetch(`${f.fake.origin}/v1/models`, {
        headers: { Authorization: `Bearer ${a.access_token}` },
      })
    ).status,
    401,
  );
  assert.equal(
    f.fake.requests.some((request) =>
      JSON.stringify(request).includes(a.access_token),
    ),
    false,
  );
  assert.ok(id);
});

test("fake authorizer rejects a changed PKCE verifier at the actual token endpoint", async (t) => {
  let result;
  const f = await fixture(t, {
    openExternal: async (url) => {
      const response = await fetch(url, { redirect: "manual" });
      const callback = new URL(response.headers.get("location"));
      const p = new URL(url).searchParams;
      result = await fetch(`${f.fake.origin}/api/accounts/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: callback.searchParams.get("client_id"),
          code: callback.searchParams.get("code"),
          code_verifier: "wrong",
          redirect_uri: p.get("redirect_uri"),
          resource: `${f.fake.origin}/v1`,
        }),
      });
      f.service.cancel();
    },
  });
  await f.service.connect();
  assert.equal(result.status, 400);
  assert.equal((await result.json()).error.code, "invalid_grant");
});

test("fake models and Responses exercise success, terminal failures and policy refusals", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const a = (await f.read()).accounts[0];
  const headers = {
    Authorization: `Bearer ${a.access_token}`,
    "Content-Type": "application/json",
  };
  const models = await (
    await fetch(`${f.fake.origin}/v1/models`, { headers })
  ).json();
  assert.equal(models.models.filter((m) => m.visibility === "list").length, 1);
  const post = (body) =>
    fetch(`${f.fake.origin}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const base = {
    model: "fake-model",
    input: [{ role: "user", content: "Hello" }],
    store: false,
    stream: true,
  };
  const success = await (await post(base)).text();
  assert.match(success, /response.completed/);
  for (const [marker, code] of [
    ["[[limit]]", "subscription_sharing_usage_limit_exceeded"],
    ["[[unavail]]", "subscription_sharing_usage_unavailable"],
  ]) {
    const stream = await (
      await post({ ...base, input: [{ role: "user", content: marker }] })
    ).text();
    assert.match(stream, /response.output_text.delta/);
    assert.match(stream, /response.failed/);
    assert.ok(stream.includes(code));
    assert.equal(stream.includes("response.completed"), false);
  }
  for (const field of "background conversation max_output_tokens max_tool_calls metadata moderation multi_agent prompt prompt_cache_retention safety_identifier temperature top_logprobs top_p truncation user previous_response_id".split(
    " ",
  )) {
    const response = await post({ ...base, [field]: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.param, field);
  }
  assert.equal(
    (
      await post({
        ...base,
        input: [{ type: "message", role: "system", content: "Hello" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await post({ ...base, tools: [{ type: "function", name: "get_time" }] }))
      .status,
    400,
  );
  const tool = await (
    await post({
      ...base,
      input: [{ role: "user", content: "[[tool]]" }],
      tools: [
        {
          type: "namespace",
          name: "colony",
          tools: [{ type: "function", name: "get_time" }],
        },
      ],
    })
  ).text();
  assert.match(tool, /function_call/);
  const completed = await (
    await post({
      ...base,
      input: [
        { type: "function_call_output", call_id: "fake-call", output: "12:00" },
      ],
    })
  ).text();
  assert.match(completed, /response.completed/);
  assert.match(completed, /Fake answer/);
});
