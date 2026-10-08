import assert from "node:assert/strict";
import test from "node:test";

import {
  describeDownloadBlock,
  describeHostFailure,
  describeNavigationBlock,
  describePageError,
  isBlockedNavigationError,
} from "./browserPageError.ts";

test("load failures become a sentence, a hint, and a small code", () => {
  const dns = describePageError("Navigation failed (ERR_NAME_NOT_RESOLVED)");
  assert.equal(dns.title, "This site can't be found");
  assert.equal(dns.detail, "ERR_NAME_NOT_RESOLVED");
  assert.equal(
    describePageError("Navigation failed (ERR_INTERNET_DISCONNECTED)").title,
    "You're offline",
  );
  assert.match(
    describePageError("Navigation failed (ERR_CERT_AUTHORITY_INVALID)").title,
    /certificate/u,
  );
  assert.match(
    describePageError("Page process stopped (crashed)").title,
    /stopped working/u,
  );
  const unknown = describePageError("Navigation failed");
  assert.equal(unknown.detail, null);
  assert.equal(unknown.title, "This page could not be opened");
});

test("only host refusals that leave the page on screen count as blocked links", () => {
  assert.equal(
    isBlockedNavigationError("Navigation to an unsupported URL was blocked"),
    true,
  );
  assert.equal(
    isBlockedNavigationError("Navigation redirected to an unsupported URL"),
    true,
  );
  assert.equal(
    isBlockedNavigationError("Navigation failed (ERR_ABORTED)"),
    false,
  );
  assert.equal(isBlockedNavigationError(null), false);
});

test("every block reason has a plain sentence, none show internals", () => {
  for (const reason of [
    "unsupported-url",
    "unsupported-link",
    "unsupported-redirect",
    "tab-limit",
    "tab-open-failed",
  ]) {
    assert.doesNotMatch(describeNavigationBlock(reason), /unsupported-|ERR_/u);
  }
  for (const reason of [
    "download-limit",
    "download-size-limit",
    "save-failed",
  ]) {
    assert.doesNotMatch(describeDownloadBlock(reason), /-limit|save-failed/u);
  }
  assert.match(
    describeHostFailure(new Error("Browser tab limit reached")),
    /Too many browser tabs/u,
  );
  assert.match(
    describeHostFailure(new Error("The embedded browser is turned off")),
    /turned off/u,
  );
  assert.equal(
    describeHostFailure(
      new Error("Link-local and cloud metadata addresses cannot be opened"),
    ),
    "Colony does not open link-local or cloud metadata addresses.",
  );
  assert.deepEqual(
    describePageError(
      describeHostFailure(
        new Error("Link-local and cloud metadata addresses cannot be opened"),
      ),
    ),
    {
      title: "This address can't be opened here",
      hint: "Colony does not open link-local or cloud metadata addresses.",
      detail: null,
    },
  );
  assert.doesNotMatch(
    describeHostFailure(new Error("ENOENT /Users/x/secret")),
    /Users/u,
  );
});
