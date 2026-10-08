import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAction,
  confirmationSummary,
  consequentialCategory,
  isCredentialField,
} from "./classifier.mjs";

const page = { origin: "https://shop.example" };
const button = (name, extra = {}) => ({ role: "button", name, ...extra });
const click = (element, form = null) =>
  classifyAction({ action: "click", element, form, page });
const codes = (result) => result.reasons.map((reason) => reason.code);

const loginForm = {
  action: "https://shop.example/login",
  method: "post",
  fields: [
    { role: "textbox", name: "Email" },
    { role: "textbox", name: "Password", inputType: "password" },
  ],
};
const searchForm = {
  action: "https://shop.example/search",
  method: "get",
  fields: [{ role: "searchbox", name: "Search" }],
};

test("read only actions are always allowed", () => {
  for (const action of [
    "scroll",
    "wait",
    "read",
    "snapshot",
    "screenshot",
    "navigate",
    "tabs",
  ]) {
    const result = classifyAction({ action, element: button("Pay now") });
    assert.equal(result.decision, "allow", action);
    assert.deepEqual(result.reasons, []);
  }
});

test("plain navigation links and search stay allowed", () => {
  assert.equal(
    click({ role: "link", name: "Kettles", href: "https://shop.example/k" })
      .decision,
    "allow",
  );
  assert.equal(click(button("Search"), searchForm).decision, "allow");
  assert.equal(click(button("Next page")).decision, "allow");
  assert.equal(click(button("Add to cart")).decision, "allow");
  assert.equal(click(button("Orders")).decision, "allow");
  assert.equal(click(button("Payments")).decision, "allow");
  assert.equal(click(button("Comments")).decision, "allow");
  assert.equal(click(button("")).decision, "allow");
});

test("buy and pay style buttons need confirmation", () => {
  for (const name of [
    "Buy",
    "Buy now",
    "Pay",
    "Pay now",
    "Pay with PayPal",
    "Purchase",
    "Place your order",
    "Checkout",
    "Check out",
    "Complete purchase",
    "Confirm payment",
    "Subscribe",
    "Donate",
    "Start free trial",
    "Upgrade now",
    "Comprar",
    "Acheter",
    "Jetzt kaufen",
    "Bezahlen",
    "Betaal",
  ]) {
    const result = click(button(name));
    assert.equal(result.decision, "confirm", name);
    assert.equal(result.category, "payment", name);
  }
});

test("send, post and publish style buttons need confirmation", () => {
  for (const name of [
    "Send",
    "Send message",
    "Post",
    "Post reply",
    "Publish",
    "Tweet",
    "Reply",
    "Comment",
    "Share",
    "Invite",
    "Submit",
    "Submit application",
    "Book now",
    "Reserve",
    "Sign up",
    "Create an account",
    "Register",
    "Enviar",
    "Senden",
  ]) {
    const result = click(button(name));
    assert.equal(result.decision, "confirm", name);
    assert.equal(result.category, "send_or_post", name);
  }
});

test("destructive and transfer buttons need confirmation", () => {
  for (const name of [
    "Delete",
    "Delete account",
    "Close my account",
    "Cancel subscription",
    "Erase",
    "Supprimer",
    "Löschen",
  ]) {
    assert.equal(click(button(name)).category, "destructive", name);
  }
  for (const name of ["Transfer", "Withdraw", "Send money", "Cash out"]) {
    assert.equal(click(button(name)).decision, "confirm", name);
  }
  assert.equal(click(button("Remove item")).decision, "allow");
});

test("permission and consent buttons need confirmation, cookie banners do not", () => {
  for (const name of [
    "Allow",
    "Allow access",
    "Grant access",
    "Authorize",
    "Authorise app",
    "Accept",
    "I agree",
    "Connect account",
    "Install",
    "Approve",
    "Permitir",
  ]) {
    const result = click(button(name));
    assert.equal(result.decision, "confirm", name);
    assert.equal(result.category, "permission", name);
  }
  assert.equal(click(button("Accept all cookies")).decision, "allow");
  assert.equal(click(button("Allow cookies")).decision, "allow");
  assert.equal(click(button("Cookie settings")).decision, "allow");
});

test("names are folded: case, zero width, full width and look-alike letters", () => {
  assert.equal(click(button("PAY NOW")).decision, "confirm");
  assert.equal(click(button("P​ay now")).decision, "confirm");
  assert.equal(click(button("Ｐａｙ")).decision, "confirm");
  // Cyrillic a, o, e, c borrowed for Latin letters.
  assert.equal(click(button("Buу")).decision, "confirm");
  assert.equal(click(button("Sеnd")).decision, "confirm");
  assert.equal(click(button("Рay")).decision, "confirm");
  assert.equal(consequentialCategory("сheсkout"), "payment");
});

test("the control label also comes from value and description", () => {
  assert.equal(
    click({ role: "button", name: "", value: "Place order" }).decision,
    "confirm",
  );
  assert.equal(
    click({ role: "button", name: "", description: "Delete forever" }).decision,
    "confirm",
  );
  assert.equal(
    click({ role: "button", name: "Go", value: "Pay now", inputType: "submit" })
      .decision,
    "confirm",
  );
});

test("submitting a form with credential or payment fields needs confirmation", () => {
  const result = click(button("Continue"), loginForm);
  assert.equal(result.decision, "confirm");
  assert.ok(codes(result).includes("credential_form_submit"));
  const payment = {
    action: "https://shop.example/pay",
    fields: [
      { role: "textbox", name: "Card number", autocomplete: "cc-number" },
      { role: "textbox", name: "Name" },
    ],
  };
  assert.equal(click(button("Next"), payment).decision, "confirm");
  const otp = {
    fields: [{ role: "textbox", name: "Code", autocomplete: "one-time-code" }],
  };
  assert.equal(click(button("Go"), otp).decision, "confirm");
  // A non submit control in the same form is not a submit.
  assert.equal(
    click(button("Show password", { buttonType: "button" }), loginForm)
      .decision,
    "allow",
  );
});

test("typing with submit follows the form rules", () => {
  const result = classifyAction({
    action: "type",
    element: { role: "textbox", name: "Email" },
    form: loginForm,
    page,
    submit: true,
    text: "me@example.com",
  });
  assert.equal(result.decision, "confirm");
  const search = classifyAction({
    action: "type",
    element: { role: "searchbox", name: "Search" },
    form: searchForm,
    page,
    submit: true,
    text: "kettle",
  });
  assert.equal(search.decision, "allow");
  assert.equal(
    classifyAction({
      action: "type",
      element: { role: "textbox", name: "Email" },
      form: loginForm,
      page,
      text: "me@example.com",
    }).decision,
    "allow",
  );
});

test("a form that posts to another origin needs confirmation", () => {
  const form = {
    action: "https://collector.evil.test/steal",
    fields: [{ role: "textbox", name: "Comment text" }],
  };
  const result = click(button("Go"), form);
  assert.equal(result.decision, "confirm");
  assert.ok(codes(result).includes("cross_origin_form"));
  const same = {
    action: "/feedback",
    fields: [{ role: "textbox", name: "Message" }],
  };
  assert.equal(click(button("Go"), same).decision, "allow");
  const broken = { action: "http://[bad", fields: [] };
  assert.equal(click(button("Go"), broken).decision, "confirm");
});

test("typing into credential fields is refused outright", () => {
  const fields = [
    { role: "textbox", name: "Password", inputType: "password" },
    { role: "textbox", name: "Anything", autocomplete: "current-password" },
    { role: "textbox", name: "Anything", autocomplete: "new-password" },
    {
      role: "textbox",
      name: "Anything",
      autocomplete: "section-pay cc-number",
    },
    { role: "textbox", name: "CVV" },
    { role: "textbox", name: "Card number" },
    { role: "spinbutton", name: "Security code" },
    { role: "textbox", name: "One-time code" },
    { role: "textbox", name: "Enter your PIN" },
    { role: "textbox", name: "IBAN" },
    { role: "textbox", name: "Passcode" },
    { role: "textbox", name: "Рassword" },
  ];
  for (const element of fields) {
    const result = classifyAction({
      action: "type",
      element,
      page,
      text: "1234",
    });
    assert.equal(result.decision, "deny", JSON.stringify(element));
    assert.ok(codes(result).includes("credential_field"));
  }
  const select = classifyAction({
    action: "select",
    element: {
      role: "combobox",
      name: "Expiry month",
      autocomplete: "cc-exp-month",
    },
    page,
  });
  assert.equal(select.decision, "deny");
});

test("ordinary fields are not mistaken for credentials", () => {
  for (const element of [
    { role: "textbox", name: "Email" },
    { role: "textbox", name: "Search" },
    { role: "textbox", name: "Quantity" },
    { role: "textbox", name: "Shipping address" },
    { role: "textbox", name: "Pinterest board" },
    { role: "textbox", name: "Passenger name" },
    { role: "searchbox", name: "Find a spinning top" },
    { role: "button", name: "Password reset" },
    { role: "link", name: "Forgot password?" },
    { role: "checkbox", name: "Remember my PIN", inputType: "checkbox" },
  ]) {
    assert.equal(isCredentialField(element), false, JSON.stringify(element));
  }
  assert.equal(
    classifyAction({
      action: "type",
      element: { role: "textbox", name: "Email" },
      page,
      text: "me@example.com",
    }).decision,
    "allow",
  );
  assert.equal(
    classifyAction({
      action: "select",
      element: { role: "combobox", name: "Size" },
      page,
    }).decision,
    "allow",
  );
});

test("text that looks like a secret cannot be typed anywhere", () => {
  for (const text of [
    `nsec1${"q".repeat(58)}`,
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "AKIAIOSFODNN7EXAMPLE",
    "4111 1111 1111 1111",
    "password=hunter22secret",
  ]) {
    const result = classifyAction({
      action: "type",
      element: { role: "textbox", name: "Notes" },
      page,
      text,
    });
    assert.equal(result.decision, "deny", text);
    assert.ok(codes(result).includes("secret_in_text"));
  }
});

test("file choosers and external protocol links are refused", () => {
  const chooser = click({
    role: "button",
    name: "Choose file",
    inputType: "file",
  });
  assert.equal(chooser.decision, "deny");
  assert.ok(codes(chooser).includes("use_upload_tool"));
  for (const href of [
    "mailto:a@b.co",
    "tel:+27111111111",
    "sms:123",
    "javascript:alert(1)",
    "intent://x#Intent;end",
    "slack://open",
  ]) {
    const result = click({ role: "link", name: "Contact", href });
    assert.equal(result.decision, "deny", href);
    assert.ok(codes(result).includes("external_protocol_link"));
  }
  assert.equal(
    click({ role: "link", name: "Docs", href: "https://shop.example/docs" })
      .decision,
    "allow",
  );
  assert.equal(
    click({ role: "link", name: "Docs", href: "/docs" }).decision,
    "allow",
  );
  assert.equal(
    click({ role: "link", name: "Top", href: "#top" }).decision,
    "allow",
  );
});

test("an upload action always needs confirmation", () => {
  const result = classifyAction({
    action: "upload",
    element: { role: "button", name: "Attach", inputType: "file" },
    page,
  });
  assert.equal(result.decision, "confirm");
  assert.ok(codes(result).includes("file_upload"));
});

test("affirmative buttons inside permission dialogs need confirmation", () => {
  const dialog = {
    inDialog: true,
    dialogRole: "dialog",
    dialogText: "shop.example wants to show notifications",
  };
  assert.equal(click(button("Allow", dialog)).decision, "confirm");
  assert.equal(click(button("Yes", dialog)).decision, "confirm");
  assert.equal(click(button("Block", dialog)).decision, "allow");
  assert.equal(click(button("Not now", dialog)).decision, "allow");
  assert.equal(
    click(
      button("OK", {
        inDialog: true,
        dialogRole: "alertdialog",
        dialogText: "Are you sure?",
      }),
    ).decision,
    "confirm",
  );
  assert.equal(
    click(
      button("Cancel", {
        inDialog: true,
        dialogRole: "alertdialog",
        dialogText: "Are you sure?",
      }),
    ).decision,
    "allow",
  );
  assert.equal(
    click(
      button("OK", {
        inDialog: true,
        dialogRole: "dialog",
        dialogText: "Newsletter",
      }),
    ).decision,
    "allow",
  );
});

test("decisions are deterministic and a deny outranks a confirm", () => {
  const both = classifyAction({
    action: "click",
    element: { role: "button", name: "Pay now", inputType: "file" },
    page,
  });
  assert.equal(both.decision, "deny");
  assert.ok(codes(both).includes("payment"));
  assert.deepEqual(click(button("Pay now")), click(button("Pay now")));
  assert.equal(classifyAction().decision, "allow");
  assert.equal(classifyAction({ action: "click" }).decision, "allow");
});

test("very long hostile names are handled quickly", () => {
  const start = Date.now();
  const name = `${"a ".repeat(50_000)}pay`;
  assert.equal(click(button(name)).decision, "allow");
  assert.ok(Date.now() - start < 500);
  const evil = `${"pay ".repeat(20_000)}`;
  assert.ok(Date.now() - start < 1_000);
  assert.equal(typeof click(button(evil)).decision, "string");
});

test("confirmation summaries are bounded, redacted and never echo typed text", () => {
  const input = {
    action: "type",
    element: { role: "textbox", name: "Notes" },
    page,
    text: "my private note",
    submit: true,
  };
  const summary = confirmationSummary(input, {
    reasons: [{ code: "cross_origin_form" }],
  });
  assert.ok(summary.includes("15 characters"));
  assert.ok(!summary.includes("private note"));
  assert.ok(summary.includes("https://shop.example"));
  assert.ok(summary.includes("cross_origin_form"));
  const hostile = confirmationSummary(
    {
      action: "click",
      element: {
        role: "button",
        name: `Send sk-ant-api03-abcdefghijklmnopqrstuvwxyz ${"x".repeat(500)}`,
      },
      page,
    },
    { reasons: [] },
  );
  assert.ok(!hostile.includes("sk-ant"));
  assert.ok(hostile.length <= 403);
});
