import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColonyCreditsOptionView } from "./ColonyCreditsOptionView.tsx";
const credits = {
  enabled: true,
  provider: "stripe",
  balanceUsdCents: 1250,
  policyUrls: {
    terms: "https://policies.example/terms",
    acceptableUse: "https://policies.example/use",
  },
};
const render = (props) =>
  renderToStaticMarkup(React.createElement(ColonyCreditsOptionView, props));
const disabled = (html, label) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);

test("configured credits show server balance, consent, accessible links and purchase/selection actions", () => {
  const html = render({ state: "ready", credits, canSelect: true });
  assert.match(html, /Current balance: \$12.50 USD/);
  for (const label of [
    "Buy credits",
    "Use Colony credits",
    "Refresh balance",
  ]) {
    assert.match(html, new RegExp(`>${label}</button>`));
    assert.equal(disabled(html, label), false);
  }
  assert.match(html, /By buying or using Colony credits you agree to the/);
  assert.match(html, /href="https:\/\/policies.example\/terms"[^>]*>Terms/);
  assert.match(
    html,
    /href="https:\/\/policies.example\/use"[^>]*>Acceptable Use Policy/,
  );
  assert.match(html, /The connection test uses your credit balance/);
  assert.doesNotMatch(html, /Coming soon|API key|<input/);
});
test("zero balance keeps purchase recovery and refuses selection", () => {
  const html = render({
    state: "ready",
    credits: { ...credits, balanceUsdCents: 0 },
    canSelect: true,
  });
  assert.match(html, /Current balance: \$0.00 USD/);
  assert.equal(disabled(html, "Buy credits"), false);
  assert.equal(disabled(html, "Use Colony credits"), true);
});
test("runtime prerequisites, fresh balance and in-flight proof fence selection", () => {
  for (const props of [
    { canSelect: false },
    { refreshing: true },
    { busy: true },
  ]) {
    const html = render({ state: "ready", credits, canSelect: true, ...props });
    assert.equal(
      disabled(
        html,
        props.busy ? "Testing Colony Agent" : "Use Colony credits",
      ),
      true,
    );
  }
});
test("off and failed gates never expose paid actions or pretend a zero balance", () => {
  for (const state of ["unconfigured", "loading", "error"]) {
    const html = render({ state, credits, canSelect: true });
    assert.doesNotMatch(html, /Buy credits|Use Colony credits|Current balance/);
    if (state === "error") {
      assert.match(html, /role="alert"/);
      assert.match(html, /Retry Colony credits/);
    } else if (state === "unconfigured") assert.match(html, />Coming soon</);
    else assert.match(html, /Checking Colony credits/);
  }
  for (const changed of [{ enabled: false }, { provider: "payfast" }])
    assert.doesNotMatch(
      render({
        state: "ready",
        credits: { ...credits, ...changed },
        canSelect: true,
      }),
      /Buy credits|Current balance/,
    );
});
