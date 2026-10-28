import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderCachedMarkdown } from "./nodeCache.ts";

const components = {
  "message-document-card": ({ body, markdown, title, wordCount }) =>
    React.createElement(
      "article",
      {
        "data-document-markdown": markdown,
        "data-document-title": title,
        "data-word-count": wordCount,
      },
      body,
    ),
};

function render(content) {
  const element = renderCachedMarkdown({
    components,
    content,
    messageFences: true,
    variant: "message-fence-test",
  });
  return renderToStaticMarkup(element);
}

test("complete doc fences use the production document-card parser", () => {
  const html = render("```doc\n# Release plan\nShip the update today.\n```");

  assert.match(html, /data-document-title="Release plan"/);
  assert.match(html, /data-word-count="6"/);
  assert.match(
    html,
    /data-document-markdown="# Release plan\nShip the update today\."/,
  );
  assert.match(html, /Ship the update today\./);
});

test("doc fences without an H1 title default to Draft", () => {
  const html = render("```doc\nA short note for the team.\n```");

  assert.match(html, /data-document-title="Draft"/);
  assert.match(html, /data-word-count="6"/);
});

test("ordinary language fences remain code blocks", () => {
  const html = render("```ts\nconst answer = 42;\n```");

  assert.match(
    html,
    /<pre><code class="language-ts">const answer = 42;\n<\/code><\/pre>/,
  );
  assert.doesNotMatch(html, /data-document-title/);
});

test("an unclosed doc fence stays a plain code block", () => {
  const html = render("```doc\n# Unfinished\nDraft text");

  assert.match(
    html,
    /<pre><code class="language-doc"># Unfinished\nDraft text\n<\/code><\/pre>/,
  );
  assert.doesNotMatch(html, /data-document-title/);
});
